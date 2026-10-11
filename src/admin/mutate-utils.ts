// Shared utilities for weighted-random drive mutation workloads (OneDrive, SharePoint).

import { randomUUID } from 'node:crypto';
import { logger } from '../logger/logger.js';

export const MAX_RUNS = 999;
export const RESULT_SAMPLE_CAP = 500;
export const MUTATE_CONCURRENCY = 5;

export interface MutationRun<T> {
  runs: number;
  totalActions: number;
  ok: number;
  failed: number;
  results: T[];
  truncated: boolean;
}

export function randomBase(): string {
  return `mutator-${randomUUID().slice(0, 8)}`;
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Replace a filename's base while keeping its extension; no extension → just the base. */
export function renameKeepingExtension(name: string, newBase: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return newBase;
  return `${newBase}${name.slice(dot)}`;
}

/** Pick an operation by weight. `rand` returns [0, 1); injectable for tests. */
export function pickWeightedOp<T>(
  weights: { op: T; weight: number }[],
  rand: () => number = Math.random,
): T {
  const total = weights.reduce((sum, { weight }) => sum + weight, 0);
  let r = rand() * total;
  for (const { op, weight } of weights) {
    if (r < weight) return op;
    r -= weight;
  }
  return weights.at(-1)!.op;
}

/**
 * Run `runs` passes of `mutateFn` over `items` through a bounded worker pool.
 * Items are selected by index modulo the items array length, avoiding a large
 * pre-built actors array. Returns totals plus a capped sample of results.
 */
export async function runMutationPool<T extends { ok: boolean }>(
  items: string[],
  runs: number,
  mutateFn: (item: string) => Promise<T>,
  logTag: string,
): Promise<MutationRun<T>> {
  const passes = Math.min(MAX_RUNS, Math.max(1, Math.round(runs)));
  logger.info(`[${logTag}] Mutating ${items.length} item(s) × ${passes} pass(es)`);
  const total = passes * items.length;
  const results: T[] = new Array(total);
  let next = 0;
  const workers = Array.from({ length: Math.min(MUTATE_CONCURRENCY, total) }, async () => {
    while (next < total) {
      const index = next++;
      results[index] = await mutateFn(items[index % items.length]);
    }
  });
  await Promise.all(workers);
  const ok = results.reduce((n, r) => n + (r.ok ? 1 : 0), 0);
  return {
    runs: passes,
    totalActions: total,
    ok,
    failed: total - ok,
    results: results.slice(0, RESULT_SAMPLE_CAP),
    truncated: total > RESULT_SAMPLE_CAP,
  };
}
