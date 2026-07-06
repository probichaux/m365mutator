// Persistence for the Targets page — the lists of users, mailboxes, and sites
// that the mutation tabs are allowed to act on.

import { join } from 'node:path';
import { getDataDir } from './config-store.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';

export const TARGET_CATEGORIES = ['identities', 'mail', 'calendar', 'onedrive', 'sharepoint'] as const;
export type TargetCategory = (typeof TARGET_CATEGORIES)[number];

export interface TargetCategoryConfig {
  enabled: boolean;
  items: string[];
}

export type TargetsConfig = Record<TargetCategory, TargetCategoryConfig>;

/** Upper bound on stored/checked items per category, to keep requests and Graph fan-out sane. */
export const MAX_ITEMS_PER_CATEGORY = 1000;

function emptyTargets(): TargetsConfig {
  return Object.fromEntries(
    TARGET_CATEGORIES.map(c => [c, { enabled: false, items: [] as string[] }]),
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
    const { enabled, items } = entry as { enabled?: unknown; items?: unknown };
    result[category] = {
      enabled: enabled === true,
      items: Array.isArray(items)
        ? items
            .filter((i): i is string => typeof i === 'string')
            .map(i => i.trim())
            .filter(i => i !== '')
            .slice(0, MAX_ITEMS_PER_CATEGORY)
        : [],
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
