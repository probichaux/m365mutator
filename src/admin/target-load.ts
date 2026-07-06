// Load all tenant objects matching a Targets category, via Microsoft Graph.

import { listAllUsers, DirectoryUser } from '../graph/users.js';
import { listAllSites } from '../graph/sites.js';
import { TargetCategory, MAX_ITEMS_PER_CATEGORY } from './targets-store.js';

export interface LoadResult {
  items: string[];
  /** Total matches found before the per-category cap was applied. */
  total: number;
  truncated: boolean;
}

/** True if the user has the named Graph service plan provisioned and enabled. */
export function hasServicePlan(user: DirectoryUser, service: string): boolean {
  return (user.assignedPlans ?? []).some(
    (p) => p.service?.toLowerCase() === service.toLowerCase() && p.capabilityStatus === 'Enabled',
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
    case 'sharepoint':
      all = dedupe(await listAllSites());
      break;
  }

  const items = all.slice(0, MAX_ITEMS_PER_CATEGORY);
  return { items, total: all.length, truncated: all.length > items.length };
}
