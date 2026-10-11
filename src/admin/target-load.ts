// Load all tenant objects matching a Targets category, via Microsoft Graph.

import { listAllUsers, DirectoryUser } from '../graph/users.js';
import { listAllSites } from '../graph/sites.js';
import { TargetCategory, TargetCategoryConfig, RunStyle } from './targets-store.js';

export interface LoadResult {
  items: string[];
  /** Total matches found before the per-category cap was applied. */
  total: number;
  truncated: boolean;
}

/**
 * True if the user has the named Graph service plan provisioned and not removed.
 * We accept any capabilityStatus except 'Deleted' — CDX/demo tenants (a primary
 * use case) report their plans as 'Suspended' even though the mailboxes and sites
 * are fully functional, so requiring 'Enabled' would exclude every user there.
 */
export function hasServicePlan(user: DirectoryUser, service: string): boolean {
  return (user.assignedPlans ?? []).some(
    (p) => p.service?.toLowerCase() === service.toLowerCase() && p.capabilityStatus !== 'Deleted',
  );
}

/** Mail and Calendar both require an Exchange Online mailbox. */
export function isMailbox(user: DirectoryUser): boolean {
  return hasServicePlan(user, 'exchange');
}

/** OneDrive is provisioned through the SharePoint/OneDrive service plan. */
export function hasOneDrive(user: DirectoryUser): boolean {
  return hasServicePlan(user, 'SharePoint');
}

/** Drop empties and duplicates while preserving order. */
function dedupe(values: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function loadUpns(predicate?: (u: DirectoryUser) => boolean): Promise<string[]> {
  const users = await listAllUsers();
  const filtered = predicate ? users.filter(predicate) : users;
  return dedupe(filtered.map((u) => u.userPrincipalName));
}

/**
 * Query the tenant for all objects matching a category and return them capped to
 * the per-category limit. Graph pagination and retry happen in the layers below.
 */
export async function loadCategory(category: TargetCategory): Promise<LoadResult> {
  let all: string[];
  switch (category) {
    case 'identities':
      all = await loadUpns();
      break;
    case 'mail':
    case 'calendar':
      all = await loadUpns(isMailbox);
      break;
    case 'onedrive':
      all = await loadUpns(hasOneDrive);
      break;
    case 'deletions':
      // Deletions can touch mail, calendar, or OneDrive, so the pool is any user
      // with a mailbox or OneDrive provisioned.
      all = await loadUpns(u => isMailbox(u) || hasOneDrive(u));
      break;
    case 'sharepoint':
      all = dedupe(await listAllSites());
      break;
  }

  return { items: all, total: all.length, truncated: false };
}

/** How many items a percentage selects from a pool of `poolSize`, at least 1 (0 if the pool is empty). */
export function sampleSize(poolSize: number, percent: number): number {
  if (poolSize <= 0) return 0;
  const clamped = Math.min(100, Math.max(1, percent));
  return Math.min(poolSize, Math.max(1, Math.round((poolSize * clamped) / 100)));
}

/** Return a random subset of `items` sized to `percent` of the pool (Fisher–Yates partial shuffle). */
export function sampleItems(items: string[], percent: number): string[] {
  const k = sampleSize(items.length, percent);
  const arr = [...items];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k);
}

export interface ResolvedTargets {
  items: string[];
  /** Size of the pool the items were drawn from (the saved list, or the loaded tenant set). */
  pool: number;
  runStyle: RunStyle;
}

/**
 * Resolve the effective items an operation should act on for a category:
 * - explicit: the saved, edited list.
 * - random: load the full set from the tenant and take a random `randomPercent`.
 */
export async function resolveTargetItems(
  category: TargetCategory,
  config: TargetCategoryConfig,
): Promise<ResolvedTargets> {
  if (config.runStyle === 'random') {
    const loaded = await loadCategory(category);
    return { items: sampleItems(loaded.items, config.randomPercent), pool: loaded.items.length, runStyle: 'random' };
  }
  return { items: config.items, pool: config.items.length, runStyle: 'explicit' };
}
