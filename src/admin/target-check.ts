// Resolve target entries against Microsoft Graph to confirm they exist.

import { getGraphClient } from '../graph/graph-client.js';
import { siteUrlToGraphPath } from '../graph/sites.js';
import { sanitizeUpstreamError } from './connectivity.js';
import { TargetCategory } from './targets-store.js';
import { logger } from '../logger/logger.js';

export interface TargetCheckResult {
  item: string;
  ok: boolean;
  error?: string;
}

/** How many Graph lookups run concurrently per check request. */
const CHECK_CONCURRENCY = 5;

// Deliberately loose: real UPN validation happens by asking Graph. This only
// catches entries that are obviously not UPNs so we can skip the round-trip.
const UPN_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null &&
    (err as { statusCode?: unknown }).statusCode === 404;
}

async function checkOne(category: TargetCategory, item: string): Promise<TargetCheckResult> {
  // Validate the entry's shape before spending a Graph round-trip on it.
  let graphPath: string;
  if (category === 'sharepoint') {
    try {
      graphPath = siteUrlToGraphPath(item);
    } catch {
      return { item, ok: false, error: 'not a valid URL' };
    }
  } else {
    if (!UPN_SHAPE.test(item)) {
      return { item, ok: false, error: 'not a valid UPN' };
    }
    graphPath = `/users/${encodeURIComponent(item)}`;
  }

  try {
    await getGraphClient().api(graphPath).select('id').get();
    return { item, ok: true };
  } catch (err) {
    const error = sanitizeUpstreamError(err);
    if (!isNotFound(err)) {
      logger.warn(`[TARGETS] Check failed for ${category} item "${item}": ${error}`);
    }
    return { item, ok: false, error: isNotFound(err) ? 'not found' : error };
  }
}

export async function checkTargets(category: TargetCategory, items: string[]): Promise<TargetCheckResult[]> {
  const results: TargetCheckResult[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CHECK_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await checkOne(category, items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
