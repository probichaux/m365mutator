// schedule.json: what the agent runs and when. Sanitized like targets.json —
// hand edits are coerced, never trusted. Problems that make the schedule unsafe
// or meaningless are returned as errors, and the scheduler refuses to run.

import { join } from 'node:path';
import { getDataDir } from '../admin/config-store.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';
import { DELETION_SCOPES, DELETION_WORKLOADS, DeletionScope, DeletionWorkload } from '../admin/deletion-mutate.js';
import { parseWorkloadRequest, WorkloadRequest } from '../admin/workload-runner.js';
import { GraphCredential } from '../graph/graph-client.js';
import { ActiveWindow, computeNextRun, parseHhMm, WEEKDAYS, Weekday } from './next-run.js';

/** Workloads in the order a cycle runs them. Identities is never run by the agent (Decision 1). */
export const SCHEDULED_WORKLOADS = ['mail', 'calendar', 'onedrive', 'sharepoint', 'deletions'] as const;
export type ScheduledWorkload = (typeof SCHEDULED_WORKLOADS)[number];

export interface Schedule {
  version: 1;
  enabled: boolean;
  intervalMinutes: number;
  jitterMinutes: number;
  runOnStart: boolean;
  activeWindow?: ActiveWindow;
  workloads: {
    mail: { enabled: boolean; runs: number; allowDeletions: boolean };
    calendar: { enabled: boolean; runs: number };
    onedrive: { enabled: boolean; runs: number };
    sharepoint: { enabled: boolean; runs: number };
    identities: { enabled: boolean };
    deletions: {
      enabled: boolean;
      workloads: DeletionWorkload[];
      scope: DeletionScope;
      /** YYYY-MM-DD, or relative to each run: -30d, -2w. */
      after?: string;
      before?: string;
      acknowledgeDestructive: boolean;
    };
  };
  /** Which identity performs each workload's Graph calls (Decision 6). */
  credentials: Record<ScheduledWorkload, GraphCredential>;
}

export interface LoadedSchedule {
  schedule: Schedule;
  /** Problems that stop the scheduler from running this schedule. */
  errors: string[];
  source: 'env' | 'file' | 'default';
}

export const MIN_INTERVAL = 5;
export const MAX_INTERVAL = 10080;
export const MAX_RUNS = 100;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function defaultSchedule(): Schedule {
  return {
    version: 1,
    enabled: false,
    intervalMinutes: 60,
    jitterMinutes: 0,
    runOnStart: false,
    workloads: {
      mail: { enabled: false, runs: 1, allowDeletions: false },
      calendar: { enabled: false, runs: 1 },
      onedrive: { enabled: false, runs: 1 },
      sharepoint: { enabled: false, runs: 1 },
      identities: { enabled: false },
      deletions: { enabled: false, workloads: [], scope: 'before', acknowledgeDestructive: false },
    },
    credentials: { mail: 'app', calendar: 'app', onedrive: 'app', sharepoint: 'app', deletions: 'app' },
  };
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Coerce arbitrary JSON into a Schedule, collecting the errors that block running it. */
export function sanitizeSchedule(raw: unknown): { schedule: Schedule; errors: string[] } {
  const r = obj(raw);
  const s = defaultSchedule();
  const errors: string[] = [];

  s.enabled = r.enabled === true;
  s.intervalMinutes = clampInt(r.intervalMinutes, MIN_INTERVAL, MAX_INTERVAL, s.intervalMinutes);
  s.jitterMinutes = clampInt(r.jitterMinutes, 0, Math.floor(s.intervalMinutes / 2), 0);
  s.runOnStart = r.runOnStart === true;

  if (r.activeWindow !== undefined) {
    const w = obj(r.activeWindow);
    const timeZone = typeof w.timeZone === 'string' ? w.timeZone : '';
    const days = Array.isArray(w.days)
      ? WEEKDAYS.filter(d => (w.days as unknown[]).some(x => typeof x === 'string' && x.toLowerCase() === d))
      : [];
    const start = typeof w.start === 'string' ? w.start : '';
    const end = typeof w.end === 'string' ? w.end : '';
    s.activeWindow = { timeZone, days: days as Weekday[], start, end };
    if (!isTimeZone(timeZone)) errors.push(`activeWindow.timeZone "${timeZone}" is not a valid IANA time zone`);
    if (days.length === 0) errors.push('activeWindow.days must include at least one day');
    if (!parseHhMm(start) || !parseHhMm(end)) errors.push('activeWindow.start and end must be HH:MM');
    else if (start === end) errors.push('activeWindow.start and end must differ');
  }

  const w = obj(r.workloads);
  const runs = (v: unknown) => clampInt(v, 1, MAX_RUNS, 1);
  const mail = obj(w.mail);
  s.workloads.mail = { enabled: mail.enabled === true, runs: runs(mail.runs), allowDeletions: mail.allowDeletions === true };
  for (const k of ['calendar', 'onedrive', 'sharepoint'] as const) {
    const e = obj(w[k]);
    s.workloads[k] = { enabled: e.enabled === true, runs: runs(e.runs) };
  }
  s.workloads.identities = { enabled: obj(w.identities).enabled === true };
  if (s.workloads.identities.enabled) {
    errors.push('Identities can\'t run as an agent: agent identities can\'t hold User.ReadWrite.All');
  }

  const del = obj(w.deletions);
  s.workloads.deletions = {
    enabled: del.enabled === true,
    workloads: Array.isArray(del.workloads) ? DELETION_WORKLOADS.filter(x => (del.workloads as unknown[]).includes(x)) : [],
    scope: DELETION_SCOPES.includes(del.scope as DeletionScope) ? del.scope as DeletionScope : 'before',
    after: typeof del.after === 'string' ? del.after : undefined,
    before: typeof del.before === 'string' ? del.before : undefined,
    acknowledgeDestructive: del.acknowledgeDestructive === true,
  };
  if (s.workloads.deletions.enabled) {
    if (!s.workloads.deletions.acknowledgeDestructive) {
      errors.push('A recurring Deletions schedule needs "acknowledgeDestructive": true');
    }
    // Validate with today's date; relative dates resolve again at each run.
    try {
      buildRequest('deletions', s, Date.now());
    } catch (err) {
      errors.push(`deletions: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const creds = obj(r.credentials);
  for (const k of SCHEDULED_WORKLOADS) {
    s.credentials[k] = creds[k] === 'agent' ? 'agent' : 'app';
  }
  return { schedule: s, errors };
}

/** Resolve "-30d" / "-2w" against `now` (UTC date); other values pass through. */
export function resolveRelativeDate(value: string | undefined, now: number): string | undefined {
  const m = value === undefined ? null : /^-(\d{1,4})([dw])$/.exec(value.trim());
  if (!m) return value;
  const days = +m[1] * (m[2] === 'w' ? 7 : 1);
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Turn a scheduled workload into a WorkloadRequest through the same parser the
 * admin routes use, so the agent and the UI validate input identically.
 */
export function buildRequest(workload: ScheduledWorkload, s: Schedule, now: number): WorkloadRequest {
  if (workload === 'deletions') {
    const d = s.workloads.deletions;
    return parseWorkloadRequest('deletions', {
      workloads: d.workloads, scope: d.scope,
      after: resolveRelativeDate(d.after, now), before: resolveRelativeDate(d.before, now),
    });
  }
  return parseWorkloadRequest(workload, s.workloads[workload]);
}

export function scheduleFilePath(): string {
  return join(getDataDir(), 'schedule.json');
}

/** The M365MUTATOR_SCHEDULE_JSON app setting wins over schedule.json in the data dir. */
export function loadSchedule(): LoadedSchedule {
  const fromEnv = process.env.M365MUTATOR_SCHEDULE_JSON;
  if (fromEnv) {
    let raw: unknown;
    try {
      raw = JSON.parse(fromEnv);
    } catch {
      return { schedule: defaultSchedule(), errors: ['M365MUTATOR_SCHEDULE_JSON is not valid JSON'], source: 'env' };
    }
    return { ...sanitizeSchedule(raw), source: 'env' };
  }
  return loadScheduleFile();
}

/** schedule.json in the data dir only, ignoring the app setting: what the Schedule page edits. */
export function loadScheduleFile(): LoadedSchedule {
  const raw = safeReadJson<unknown>(scheduleFilePath(), null);
  if (raw === null) return { schedule: defaultSchedule(), errors: [], source: 'default' };
  return { ...sanitizeSchedule(raw), source: 'file' };
}

/** Sanitize and write schedule.json. A schedule with errors is not written. */
export function saveSchedule(raw: unknown): { schedule: Schedule; errors: string[] } {
  const result = sanitizeSchedule(raw);
  if (result.errors.length === 0) atomicWriteJson(scheduleFilePath(), result.schedule);
  return result;
}

/** The next `count` run times from `now`, without jitter (jitter centred at zero). */
export function previewRuns(s: Schedule, now: number, count = 5): string[] {
  const runs: string[] = [];
  let at: number | null = now;
  while (runs.length < count) {
    at = computeNextRun(at, s, () => 0.5);
    if (at === null) break;
    runs.push(new Date(at).toISOString());
  }
  return runs;
}
