// Process-wide record of throttling responses (429, 503, 504) from Graph and
// from Outlook attachment uploads, so a long run can show how hard the service
// is pushing back. Counters only grow; callers diff two snapshots.

import { logger } from '../logger/logger.js';

export type ThrottleSource = 'graph' | 'upload';

/** Status codes that mean "slow down": 429 Too Many Requests, 503 Service Unavailable, 504 Gateway Timeout. */
export function isThrottleStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}

export interface ThrottleSnapshot {
  events: number;
  /** 429 Too Many Requests. */
  tooMany: number;
  /** 503 or 504: the service is busy. */
  busy: number;
  /** Seconds spent waiting before retrying (Retry-After or backoff), summed; approximate. */
  waitSeconds: number;
  lastAt?: string;
  lastStatus?: number;
  lastSource?: ThrottleSource;
}

/** A throttle within this window counts as "currently throttled". */
export const RECENT_WINDOW_MS = 5 * 60 * 1000;

const totals: ThrottleSnapshot = { events: 0, tooMany: 0, busy: 0, waitSeconds: 0 };
const recent: number[] = [];

/**
 * Count one throttling response. `retrying` is false for the response that
 * exhausts the retry budget, which fails the request instead of waiting.
 */
export function recordThrottle(status: number, waitSeconds: number, source: ThrottleSource, retrying = true): void {
  const now = Date.now();
  totals.events++;
  if (status === 429) totals.tooMany++; else totals.busy++;
  totals.waitSeconds += Math.max(0, waitSeconds);
  totals.lastAt = new Date(now).toISOString();
  totals.lastStatus = status;
  totals.lastSource = source;
  recent.push(now);
  while (recent.length > 0 && now - recent[0] > RECENT_WINDOW_MS) recent.shift();
  logger.warn(retrying
    ? `[THROTTLE] ${source} returned ${status}; retrying in about ${Math.round(waitSeconds)}s`
    : `[THROTTLE] ${source} returned ${status}; no retries left, failing the request`);
}

export function throttleSnapshot(): ThrottleSnapshot {
  return { ...totals };
}

/** Throttle events in the last five minutes. */
export function recentThrottleCount(now = Date.now()): number {
  return recent.filter(t => now - t <= RECENT_WINDOW_MS).length;
}

/** Events between two snapshots; the "last" fields come from `later`. */
export function throttleDelta(earlier: ThrottleSnapshot, later: ThrottleSnapshot): ThrottleSnapshot {
  const events = later.events - earlier.events;
  return {
    events,
    tooMany: later.tooMany - earlier.tooMany,
    busy: later.busy - earlier.busy,
    waitSeconds: later.waitSeconds - earlier.waitSeconds,
    ...(events > 0 ? { lastAt: later.lastAt, lastStatus: later.lastStatus, lastSource: later.lastSource } : {}),
  };
}

/** Parse a Retry-After header (seconds or an HTTP date); undefined when absent or unreadable. */
export function retryAfterSeconds(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, (at - now) / 1000) : undefined;
}
