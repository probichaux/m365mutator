// Runs a mail mutation as a background job so it survives the browser leaving
// the Mail tab. The page starts a job, then polls for progress and can ask it to
// stop. One job runs at a time: every action shares the same mailboxes'
// throttling budget, so parallel jobs would only slow each other down.
// Job state lives in memory and is lost when the server restarts.

import { randomUUID } from 'node:crypto';
import { mutateMail, MailResult, MailSizeOptions, MailStopReason, MAX_RUNS } from './mail-mutate.js';
import { sanitizeUpstreamError } from './connectivity.js';
import {
  throttleSnapshot, throttleDelta, recentThrottleCount, ThrottleSnapshot,
} from '../graph/throttle-stats.js';
import { logger } from '../logger/logger.js';

export type MailJobStatus = 'running' | 'paused' | 'stopping' | 'done' | 'stopped' | 'error';

export interface MailJobThrottle extends ThrottleSnapshot {
  /** Throttle events in the last five minutes, across the whole server. */
  recentEvents: number;
}

export interface MailJob {
  id: string;
  status: MailJobStatus;
  continuous: boolean;
  startedAt: string;
  finishedAt?: string;
  /** Set while a continuous run waits out the daily cap. */
  resumeAt?: string;
  stopReason?: MailStopReason;
  mailboxes: number;
  runs: number;
  /** Actions planned: runs × mailboxes; null for a continuous run. */
  planned: number | null;
  /** Actions finished so far, successful or not. */
  completed: number;
  ok: number;
  failed: number;
  /** Actions not attempted because of the daily cap or a stop request (known when the job ends). */
  skipped: number;
  bytesAdded: number;
  bytesToday: number;
  capBytes: number;
  runStyle: string;
  /** Throttling seen since this job started. */
  throttle: MailJobThrottle;
  /** The most recent results, newest last. */
  recent: MailResult[];
  error?: string;
}

const RECENT_CAP = 200;
/** How often an active job writes a progress line to the log. */
const STATUS_LOG_MS = 10 * 60 * 1000;

let current: MailJob | null = null;
let throttleBaseline: ThrottleSnapshot = throttleSnapshot();
let stopRequested = false;

const formatGb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

/** The current job with live throttling figures filled in. */
export function getMailJob(): MailJob | null {
  if (current && isMailJobActive()) {
    current.throttle = { ...throttleDelta(throttleBaseline, throttleSnapshot()), recentEvents: recentThrottleCount() };
  }
  return current;
}

export function isMailJobActive(): boolean {
  return current?.status === 'running' || current?.status === 'paused' || current?.status === 'stopping';
}

export function stopMailJob(): MailJob | null {
  if (current && (current.status === 'running' || current.status === 'paused')) {
    stopRequested = true;
    current.status = 'stopping';
    logger.info(`[MAIL] Stop requested for job ${current.id}`);
  }
  return getMailJob();
}

function logStatus(job: MailJob): void {
  const t = job.throttle;
  logger.info(
    `[MAIL] Job ${job.id.slice(0, 8)} ${job.status}: ${job.completed} actions (${job.ok} ok, ${job.failed} failed), ` +
    `~${formatGb(job.bytesAdded)} added, ~${formatGb(job.bytesToday)} today; ` +
    `throttled ${t.events}× (${t.tooMany}× 429, ${t.busy}× 503/504), ${t.recentEvents} in the last 5 min`,
  );
}

/**
 * Start a job and return it immediately; the run continues in the background.
 * Callers must check isMailJobActive() first.
 */
export function startMailJob(
  items: string[],
  runs: number,
  allowDeletions: boolean,
  size: MailSizeOptions,
  runStyle: string,
  startingBytesToday: number,
  continuous = false,
): MailJob {
  const passes = continuous ? 0 : Math.min(MAX_RUNS, Math.max(1, Math.round(runs)));
  throttleBaseline = throttleSnapshot();
  const job: MailJob = {
    id: randomUUID(),
    status: 'running',
    continuous,
    startedAt: new Date().toISOString(),
    mailboxes: items.length,
    runs: passes,
    planned: continuous ? null : passes * items.length,
    completed: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    bytesAdded: 0,
    bytesToday: startingBytesToday,
    capBytes: Math.round(size.dailyCapGb * 1024 ** 3),
    runStyle,
    throttle: { events: 0, tooMany: 0, busy: 0, waitSeconds: 0, recentEvents: 0 },
    recent: [],
  };
  current = job;
  stopRequested = false;

  const statusTimer = setInterval(() => logStatus(getMailJob() ?? job), STATUS_LOG_MS);
  statusTimer.unref();

  mutateMail(items, passes, allowDeletions, size, {
    shouldStop: () => stopRequested,
    onResult: (result, bytesToday) => {
      job.completed++;
      if (result.ok) job.ok++; else job.failed++;
      // Summing each action keeps the total right across midnight; the run's final figure reconciles it.
      job.bytesAdded += result.bytes ?? 0;
      job.bytesToday = bytesToday;
      job.recent.push(result);
      if (job.recent.length > RECENT_CAP) job.recent.shift();
    },
    onPause: resumeAt => {
      if (job.status === 'running') job.status = 'paused';
      job.resumeAt = resumeAt.toISOString();
    },
    onResume: () => {
      job.bytesToday = 0;
      if (job.status === 'paused') job.status = 'running';
      delete job.resumeAt;
    },
  }, { continuous })
    .then(run => {
      job.skipped = run.skipped;
      job.bytesAdded = run.bytesAdded;
      job.bytesToday = run.bytesToday;
      job.stopReason = run.stopReason;
      job.status = run.stopReason === 'stopped' ? 'stopped' : 'done';
      if (run.stopReason === 'failures') {
        job.error = job.recent.filter(r => !r.ok).at(-1)?.error ?? 'Too many failures in a row';
      }
    })
    .catch(err => {
      job.error = sanitizeUpstreamError(err);
      job.status = 'error';
      logger.error(`[MAIL] Job ${job.id} failed: ${job.error}`);
    })
    .finally(() => {
      clearInterval(statusTimer);
      job.throttle = { ...throttleDelta(throttleBaseline, throttleSnapshot()), recentEvents: recentThrottleCount() };
      job.finishedAt = new Date().toISOString();
      delete job.resumeAt;
      logStatus(job);
    });

  return job;
}
