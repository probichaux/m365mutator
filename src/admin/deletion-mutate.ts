// Delete a date-scoped range of items across selected workloads for each user.
//
// Deletions are soft (recoverable): mail and calendar go to Deleted Items /
// recoverable items, OneDrive to the recycle bin — which is what deleted-item
// recovery testing needs. Items are matched by the date they arrived: received
// date for mail, created date for calendar events and files. Boundary dates are
// inclusive.

import { listMessagesByFilter, deleteMessage } from '../graph/mail.js';
import { listEventsByFilter, deleteEvent } from '../graph/calendar.js';
import { listOneDriveItemsByDate, deleteOneDriveFile, DateRange } from '../graph/files.js';
import { sanitizeUpstreamError } from './connectivity.js';
import { logger } from '../logger/logger.js';

export type DeletionWorkload = 'mail' | 'calendar' | 'onedrive';
export const DELETION_WORKLOADS: DeletionWorkload[] = ['mail', 'calendar', 'onedrive'];

export type DeletionScope = 'all' | 'after' | 'before' | 'between';
export const DELETION_SCOPES: DeletionScope[] = ['all', 'after', 'before', 'between'];

export interface DeletionResult {
  /** The user (UPN) whose items were deleted. */
  item: string;
  workload: DeletionWorkload;
  /** True when every matched item was deleted without error. */
  ok: boolean;
  /** Items that matched the scope. */
  matched: number;
  /** Items deleted successfully. */
  deleted: number;
  /** Item deletions that failed. */
  failed: number;
  /** Set when the whole pair failed before deleting (e.g. listing threw). */
  error?: string;
}

export interface DeletionRun {
  scope: DeletionScope;
  workloads: DeletionWorkload[];
  /** Number of users acted on. */
  users: number;
  /** Total items matched across all pairs. */
  matched: number;
  /** Total items deleted successfully. */
  deleted: number;
  /** Total item deletions that failed, plus pairs that errored before deleting. */
  failed: number;
  /** A capped sample of per-(user × workload) results for display. */
  results: DeletionResult[];
  /** True when more pairs ran than are included in `results`. */
  truncated: boolean;
}

/** user × workload pairs deleted in parallel. */
const PAIR_CONCURRENCY = 5;
/** item deletions within a single pair run in parallel. */
const ITEM_CONCURRENCY = 4;
/** Cap on items deleted per (user × workload) pair, to bound a single run. */
export const MAX_DELETE_PER_PAIR = 1000;
/** Cap on per-pair results returned so a large run does not ship a huge payload. */
const RESULT_SAMPLE_CAP = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed calendar date string, "YYYY-MM-DD". */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/**
 * Translate a scope + dates into an inclusive UTC window. `after` is the lower
 * bound (start of that day); `before` is the upper bound (end of that day).
 */
export function scopeToRange(scope: DeletionScope, after?: string, before?: string): DateRange {
  switch (scope) {
    case 'after': return { afterIso: `${after}T00:00:00Z` };
    case 'before': return { beforeIso: `${before}T23:59:59Z` };
    case 'between': return { afterIso: `${after}T00:00:00Z`, beforeIso: `${before}T23:59:59Z` };
    case 'all':
    default: return {};
  }
}

/** Build an OData `$filter` for a date field from a range, or undefined for an open range. */
export function buildDateFilter(field: string, range: DateRange): string | undefined {
  const parts: string[] = [];
  if (range.afterIso) parts.push(`${field} ge ${range.afterIso}`);
  if (range.beforeIso) parts.push(`${field} le ${range.beforeIso}`);
  return parts.length ? parts.join(' and ') : undefined;
}

async function listMatches(user: string, workload: DeletionWorkload, range: DateRange): Promise<{ id: string }[]> {
  if (workload === 'mail') return listMessagesByFilter(user, buildDateFilter('receivedDateTime', range));
  if (workload === 'calendar') return listEventsByFilter(user, buildDateFilter('createdDateTime', range));
  return listOneDriveItemsByDate(user, range);
}

async function deleteItem(user: string, workload: DeletionWorkload, id: string): Promise<void> {
  if (workload === 'mail') return deleteMessage(user, id);
  if (workload === 'calendar') return deleteEvent(user, id);
  return deleteOneDriveFile(user, id);
}

async function deletePair(user: string, workload: DeletionWorkload, range: DateRange): Promise<DeletionResult> {
  let items: { id: string }[];
  try {
    items = (await listMatches(user, workload, range)).slice(0, MAX_DELETE_PER_PAIR);
  } catch (err) {
    const error = sanitizeUpstreamError(err);
    logger.warn(`[DEL] listing ${workload} failed for "${user}": ${error}`);
    return { item: user, workload, ok: false, matched: 0, deleted: 0, failed: 0, error };
  }

  let deleted = 0;
  let failed = 0;
  let next = 0;
  const workers = Array.from({ length: Math.min(ITEM_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        await deleteItem(user, workload, items[index].id);
        deleted++;
      } catch (err) {
        failed++;
        logger.warn(`[DEL] delete ${workload} item failed for "${user}": ${sanitizeUpstreamError(err)}`);
      }
    }
  });
  await Promise.all(workers);

  return { item: user, workload, ok: failed === 0, matched: items.length, deleted, failed };
}

/**
 * Delete matching items for every (user × workload) pair through a bounded worker
 * pool, so one failure does not abort the rest. Returns totals plus a capped
 * sample of per-pair results.
 */
export async function mutateDeletions(
  users: string[],
  workloads: DeletionWorkload[],
  scope: DeletionScope,
  after?: string,
  before?: string,
): Promise<DeletionRun> {
  const range = scopeToRange(scope, after, before);
  const pairs: { user: string; workload: DeletionWorkload }[] = [];
  for (const user of users) {
    for (const workload of workloads) pairs.push({ user, workload });
  }
  logger.info(`[DEL] Deleting from ${users.length} user(s) × [${workloads.join(', ')}], scope=${scope}`);

  const results: DeletionResult[] = new Array(pairs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(PAIR_CONCURRENCY, pairs.length) }, async () => {
    while (next < pairs.length) {
      const index = next++;
      results[index] = await deletePair(pairs[index].user, pairs[index].workload, range);
    }
  });
  await Promise.all(workers);

  const matched = results.reduce((s, r) => s + r.matched, 0);
  const deleted = results.reduce((s, r) => s + r.deleted, 0);
  const failed = results.reduce((s, r) => s + r.failed, 0) + results.filter(r => r.error).length;

  return {
    scope,
    workloads,
    users: users.length,
    matched,
    deleted,
    failed,
    results: results.slice(0, RESULT_SAMPLE_CAP),
    truncated: results.length > RESULT_SAMPLE_CAP,
  };
}
