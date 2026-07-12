// Persistence for the Targets page — the lists of users, mailboxes, and sites
// that the mutation tabs are allowed to act on.

import { join } from 'node:path';
import { getDataDir } from './config-store.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';

export const TARGET_CATEGORIES = ['identities', 'mail', 'calendar', 'onedrive', 'sharepoint', 'deletions'] as const;
export type TargetCategory = (typeof TARGET_CATEGORIES)[number];

/** How an operation chooses its targets: the edited list, or a random % of the tenant. */
export type RunStyle = 'explicit' | 'random';

export const DEFAULT_RANDOM_PERCENT = 10;

export interface TargetCategoryConfig {
  enabled: boolean;
  items: string[];
  runStyle: RunStyle;
  randomPercent: number;
}

export type TargetsConfig = Record<TargetCategory, TargetCategoryConfig>;

/** Upper bound on stored/checked items per category, to keep requests and Graph fan-out sane. */
export const MAX_ITEMS_PER_CATEGORY = 1000;

/** Clamp an arbitrary value to a whole percentage in [1, 100], falling back to the default. */
function clampPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RANDOM_PERCENT;
  return Math.min(100, Math.max(1, Math.round(value)));
}

function emptyTargets(): TargetsConfig {
  return Object.fromEntries(
    TARGET_CATEGORIES.map(c => [c, { enabled: false, items: [] as string[], runStyle: 'explicit', randomPercent: DEFAULT_RANDOM_PERCENT }]),
  ) as unknown as TargetsConfig;
}

function getTargetsPath(): string {
  return join(getDataDir(), 'targets.json');
}

/** Coerce arbitrary (possibly hand-edited) JSON into a well-formed TargetsConfig. */
function sanitizeTargets(raw: unknown): TargetsConfig {
  const result = emptyTargets();
  if (typeof raw !== 'object' || raw === null) return result;
  for (const category of TARGET_CATEGORIES) {
    const entry = (raw as Record<string, unknown>)[category];
    if (typeof entry !== 'object' || entry === null) continue;
    const { enabled, items, runStyle, randomPercent } = entry as {
      enabled?: unknown; items?: unknown; runStyle?: unknown; randomPercent?: unknown;
    };
    result[category] = {
      enabled: enabled === true,
      items: Array.isArray(items)
        ? items
            .filter((i): i is string => typeof i === 'string')
            .map(i => i.trim())
            .filter(i => i !== '')
            .slice(0, MAX_ITEMS_PER_CATEGORY)
        : [],
      runStyle: runStyle === 'random' ? 'random' : 'explicit',
      randomPercent: clampPercent(randomPercent),
    };
  }
  return result;
}

export function loadTargets(): TargetsConfig {
  return sanitizeTargets(safeReadJson<unknown>(getTargetsPath(), {}));
}

export function saveTargets(raw: unknown): TargetsConfig {
  const targets = sanitizeTargets(raw);
  atomicWriteJson(getTargetsPath(), targets);
  return targets;
}

/**
 * Update a single category, merging into the persisted config so the other
 * categories are preserved. Fields omitted from `partial` keep their current
 * values. Each workload page owns one category and saves independently, so a
 * whole-config replace would clobber the others.
 */
export function saveTargetCategory(
  category: TargetCategory,
  partial: { enabled?: unknown; items?: unknown; runStyle?: unknown; randomPercent?: unknown },
): TargetsConfig {
  const current = loadTargets();
  const existing = current[category];
  const merged: TargetsConfig = {
    ...current,
    [category]: {
      enabled: typeof partial.enabled === 'boolean' ? partial.enabled : existing.enabled,
      items: partial.items !== undefined ? partial.items : existing.items,
      runStyle: partial.runStyle === 'explicit' || partial.runStyle === 'random' ? partial.runStyle : existing.runStyle,
      randomPercent: partial.randomPercent !== undefined ? clampPercent(partial.randomPercent) : existing.randomPercent,
    },
  };
  return saveTargets(merged);
}
