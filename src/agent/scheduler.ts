// The agent-mode scheduler: arms a setTimeout for the next cycle, checks the
// agent identity can still get a token, then runs the enabled workloads one
// after another through the shared engine.

import { unwatchFile, watchFile } from 'node:fs';
import type { TokenCredential } from '@azure/identity';
import { logger } from '../logger/logger.js';
import { sanitizeUpstreamError } from '../admin/connectivity.js';
import { runWorkload, WorkloadResult, WorkloadRequest, RunOptions } from '../admin/workload-runner.js';
import { createAgentIdentityCredential, GraphAuthManager } from '../graph/graph-auth.js';
import { GraphCredential } from '../graph/graph-client.js';
import { clampToWindow, computeNextRun, inWindow } from './next-run.js';
import {
  buildRequest, loadSchedule, LoadedSchedule, Schedule, scheduleFilePath, SCHEDULED_WORKLOADS,
} from './schedule-store.js';
import { appendRun, CycleSummary, loadRuns, WorkloadSummary } from './run-history.js';

const MINUTE = 60_000;
/** setTimeout's ceiling; longer waits re-arm when they fire early. */
const MAX_TIMEOUT = 2 ** 31 - 1;
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

export interface SchedulerDeps {
  loadSchedule: () => LoadedSchedule;
  runWorkload: (req: WorkloadRequest, opts: RunOptions) => Promise<WorkloadResult>;
  /**
   * Throws when the credential can't get a Graph token. For the agent that
   * means disabled, deleted or misconfigured; for the app, usually an expired
   * or rotated secret.
   */
  checkToken: (credential: GraphCredential) => Promise<void>;
  appendRun: (summary: CycleSummary) => void;
  loadRuns: () => CycleSummary[];
  now: () => number;
  random: () => number;
  /** Re-read the schedule when schedule.json changes. Off in tests. */
  watch: boolean;
}

export interface TokenHealth {
  ok: boolean;
  checkedAt: string;
  error?: string;
}

export interface SchedulerStatus {
  mode: 'agent';
  enabled: boolean;
  source: LoadedSchedule['source'];
  errors: string[];
  state: 'idle' | 'waiting' | 'running' | 'stopped';
  nextRunAt: string | null;
  /** Non-zero while backing off after a failed token check. */
  backoffMinutes: number;
  intervalMinutes: number;
  /** Identity performing each enabled workload's Graph calls; directory lookups use the agent. */
  credentials: Partial<Record<string, GraphCredential>>;
  /** Result of the last token check per credential; `app` only when a workload uses it. */
  tokenHealth: Partial<Record<GraphCredential, TokenHealth>>;
  lastCycle: CycleSummary | null;
}

function defaultCheckToken(): (credential: GraphCredential) => Promise<void> {
  // Built once and reused, so their token caches make repeat checks cheap.
  const credentials: Partial<Record<GraphCredential, TokenCredential>> = {};
  return async (kind) => {
    credentials[kind] ??= kind === 'agent' ? createAgentIdentityCredential() : new GraphAuthManager().getCredential();
    const token = await credentials[kind].getToken(GRAPH_SCOPE);
    if (!token) throw new Error('No token returned');
  };
}

/** ok/failed counts from any workload's run result. */
function counts(result: WorkloadResult): { ok: number; failed: number } {
  if ('deleted' in result) return { ok: result.deleted, failed: result.failed };
  if ('ok' in result) return { ok: result.ok, failed: result.failed };
  const ok = result.results.filter(r => r.ok).length;
  return { ok, failed: result.results.length - ok };
}

export class Scheduler {
  private readonly deps: SchedulerDeps;
  private loaded: LoadedSchedule;
  private timer?: NodeJS.Timeout;
  private nextRunAt: number | null = null;
  private running?: Promise<void>;
  private stopped = false;
  /** Only a started scheduler arms timers; runNow() alone never schedules more cycles. */
  private started = false;
  private backoffMs = 0;
  private tokenHealth: Partial<Record<GraphCredential, TokenHealth>> = {};
  private lastCycle: CycleSummary | null;

  constructor(deps: Partial<SchedulerDeps> = {}) {
    this.deps = {
      loadSchedule,
      runWorkload,
      checkToken: defaultCheckToken(),
      appendRun,
      loadRuns,
      now: Date.now,
      random: Math.random,
      watch: true,
      ...deps,
    };
    this.loaded = this.deps.loadSchedule();
    this.lastCycle = this.deps.loadRuns().at(-1) ?? null;
  }

  private get schedule(): Schedule {
    return this.loaded.schedule;
  }

  private get runnable(): boolean {
    return this.schedule.enabled && this.loaded.errors.length === 0;
  }

  start(): void {
    this.stopped = false;
    this.started = true;
    if (this.deps.watch && this.loaded.source !== 'env') {
      watchFile(scheduleFilePath(), { interval: 5000 }, () => this.reload());
    }
    this.armFirst();
  }

  /** Re-read schedule.json and re-arm from now. */
  reload(): void {
    const next = this.deps.loadSchedule();
    if (JSON.stringify(next) === JSON.stringify(this.loaded)) return;
    logger.info('[AGENT] Schedule changed; re-arming');
    this.loaded = next;
    this.backoffMs = 0;
    this.armFirst();
  }

  private armFirst(): void {
    this.clearTimer();
    if (this.loaded.errors.length > 0) {
      logger.error(`[AGENT] Schedule rejected: ${this.loaded.errors.join('; ')}`);
      return;
    }
    if (!this.schedule.enabled) {
      logger.info('[AGENT] Schedule is disabled; nothing will run');
      return;
    }
    const now = this.deps.now();
    if (this.schedule.runOnStart && inWindow(now, this.schedule.activeWindow)) {
      this.arm(now);
    } else {
      this.arm(computeNextRun(now, this.schedule, this.deps.random));
    }
  }

  private arm(at: number | null): void {
    this.clearTimer();
    this.nextRunAt = at;
    if (at === null || this.stopped || !this.started) return;
    const delay = Math.min(Math.max(0, at - this.deps.now()), MAX_TIMEOUT);
    this.timer = setTimeout(() => this.fire(), delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private fire(): void {
    const now = this.deps.now();
    if (this.nextRunAt !== null && now < this.nextRunAt) {
      this.arm(this.nextRunAt); // a wait longer than setTimeout's ceiling
      return;
    }
    // Keep cadence from the scheduled time, not the end of the cycle.
    this.arm(computeNextRun(now, this.schedule, this.deps.random));
    if (this.running) {
      logger.warn('[AGENT] Previous cycle still running; skipping this one');
      return;
    }
    this.running = this.runCycle().finally(() => { this.running = undefined; });
  }

  /**
   * Run one cycle now, outside the timer, and return its summary. The Schedule
   * page uses this to test a schedule exactly as the agent would run it.
   */
  async runNow(): Promise<CycleSummary> {
    if (this.running) throw new Error('A cycle is already running');
    this.running = this.runCycle().finally(() => { this.running = undefined; });
    await this.running;
    return this.lastCycle!;
  }

  private async runCycle(): Promise<void> {
    const startedAt = this.deps.now();
    const iso = (t: number) => new Date(t).toISOString();

    try {
      await this.deps.checkToken('agent');
      this.tokenHealth.agent = { ok: true, checkedAt: iso(this.deps.now()) };
      this.backoffMs = 0;
    } catch (err) {
      // A disabled or deleted agent stops every write, including app-credential ones.
      const error = sanitizeUpstreamError(err);
      this.tokenHealth.agent = { ok: false, checkedAt: iso(this.deps.now()), error };
      const interval = this.schedule.intervalMinutes * MINUTE;
      this.backoffMs = Math.min(interval, this.backoffMs ? this.backoffMs * 2 : MINUTE);
      logger.error(`[AGENT] Agent token check failed; retrying in ${this.backoffMs / MINUTE} min: ${error}`);
      const retryAt = this.deps.now() + this.backoffMs;
      const window = this.schedule.activeWindow;
      this.arm(window ? clampToWindow(retryAt, window) : retryAt);
      this.record({ startedAt: iso(startedAt), endedAt: iso(this.deps.now()), status: 'blocked', workloads: [], error });
      return;
    }

    // Check the app registration once, rather than letting every action fail on it.
    const enabled = SCHEDULED_WORKLOADS.filter(w => this.schedule.workloads[w].enabled);
    let appError: string | undefined;
    if (enabled.some(w => this.schedule.credentials[w] === 'app')) {
      try {
        await this.deps.checkToken('app');
        this.tokenHealth.app = { ok: true, checkedAt: iso(this.deps.now()) };
      } catch (err) {
        appError = sanitizeUpstreamError(err);
        this.tokenHealth.app = { ok: false, checkedAt: iso(this.deps.now()), error: appError };
        logger.error(`[AGENT] App registration token check failed; skipping its workloads: ${appError}`);
      }
    } else {
      delete this.tokenHealth.app;
    }

    const workloads: WorkloadSummary[] = [];
    for (const workload of enabled) {
      if (this.stopped) break;
      const credential = this.schedule.credentials[workload];
      const t0 = this.deps.now();
      if (credential === 'app' && appError) {
        workloads.push({ workload, credential, ok: 0, failed: 0, durationMs: 0, error: `App registration token failed: ${appError}` });
        continue;
      }
      try {
        const req = buildRequest(workload, this.schedule, t0);
        const result = await this.deps.runWorkload(req, { credential, directoryCredential: 'agent' });
        workloads.push({ workload, credential, ...counts(result), durationMs: this.deps.now() - t0 });
      } catch (err) {
        const error = sanitizeUpstreamError(err);
        logger.warn(`[AGENT] ${workload} failed: ${error}`);
        workloads.push({ workload, credential, ok: 0, failed: 0, durationMs: this.deps.now() - t0, error });
      }
    }

    const errored = workloads.filter(w => w.error).length;
    const status: CycleSummary['status'] = workloads.length > 0 && errored === workloads.length
      ? 'failed'
      : errored > 0 || workloads.some(w => w.failed > 0) ? 'partial' : 'ok';
    this.record({ startedAt: iso(startedAt), endedAt: iso(this.deps.now()), status, workloads });
  }

  private record(summary: CycleSummary): void {
    this.lastCycle = summary;
    logger.info(`[AGENT] Cycle ${summary.status}: ${summary.workloads.map(w => `${w.workload} ${w.ok} ok/${w.failed} failed${w.error ? ' (error)' : ''}`).join(', ') || 'no workloads'}`);
    try {
      this.deps.appendRun(summary);
    } catch (err) {
      logger.warn('[AGENT] Could not write run history', err);
    }
  }

  /** Stop arming cycles and wait up to `drainMs` for the current one. */
  async stop(drainMs = 60_000): Promise<void> {
    this.stopped = true;
    this.clearTimer();
    this.nextRunAt = null;
    if (this.deps.watch) unwatchFile(scheduleFilePath());
    if (this.running) {
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        this.running,
        new Promise<void>(resolve => { timeout = setTimeout(resolve, drainMs); }),
      ]);
      clearTimeout(timeout);
    }
  }

  status(): SchedulerStatus {
    const credentials: Partial<Record<string, GraphCredential>> = {};
    for (const w of SCHEDULED_WORKLOADS) {
      if (this.schedule.workloads[w].enabled) credentials[w] = this.schedule.credentials[w];
    }
    let state: SchedulerStatus['state'] = 'idle';
    if (this.stopped) state = 'stopped';
    else if (this.running) state = 'running';
    else if (this.runnable && this.nextRunAt !== null) state = 'waiting';
    return {
      mode: 'agent',
      enabled: this.schedule.enabled,
      source: this.loaded.source,
      errors: this.loaded.errors,
      state,
      nextRunAt: this.nextRunAt === null ? null : new Date(this.nextRunAt).toISOString(),
      backoffMinutes: this.backoffMs / MINUTE,
      intervalMinutes: this.schedule.intervalMinutes,
      credentials,
      tokenHealth: this.tokenHealth,
      lastCycle: this.lastCycle,
    };
  }
}
