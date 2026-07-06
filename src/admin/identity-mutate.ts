// Randomly mutate one attribute across the selected Identities targets.

import { updateUser } from '../graph/users.js';
import { MutableAttribute, pickRandomAttribute } from '../graph/user-attributes.js';
import { sanitizeUpstreamError } from './connectivity.js';
import { logger } from '../logger/logger.js';

export interface MutationResult {
  item: string;
  ok: boolean;
  /** The random value applied (present whether or not the PATCH succeeded). */
  value: unknown;
  error?: string;
}

export interface MutationRun {
  attribute: string;
  label: string;
  results: MutationResult[];
}

/** How many Graph PATCH calls run concurrently. */
const MUTATE_CONCURRENCY = 5;

async function mutateOne(item: string, attribute: MutableAttribute): Promise<MutationResult> {
  const value = attribute.generate();
  try {
    await updateUser(encodeURIComponent(item), { [attribute.name]: value });
    logger.info(`[IDENTITIES] Set ${attribute.name} on "${item}"`);
    return { item, ok: true, value };
  } catch (err) {
    const error = sanitizeUpstreamError(err);
    logger.warn(`[IDENTITIES] Failed to set ${attribute.name} on "${item}": ${error}`);
    return { item, ok: false, value, error };
  }
}

/**
 * Pick one attribute at random, then set a fresh random value for it on every
 * selected user. Each user is PATCHed independently so one failure does not
 * abort the rest.
 */
export async function mutateIdentities(items: string[]): Promise<MutationRun> {
  const attribute = pickRandomAttribute();
  logger.info(`[IDENTITIES] Mutating attribute "${attribute.name}" across ${items.length} identities`);

  const results: MutationResult[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(MUTATE_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mutateOne(items[index], attribute);
    }
  });
  await Promise.all(workers);

  return { attribute: attribute.name, label: attribute.label, results };
}
