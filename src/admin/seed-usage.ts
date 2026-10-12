// Tracks roughly how many bytes mail mutations have added today, so a run can
// stop at a daily cap. Microsoft supports auto-expanding archives only for
// mailboxes that grow by no more than 1 GB per day.

import { join } from 'node:path';
import { getDataDir } from './config-store.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';

interface SeedUsage {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  bytes: number;
}

function usagePath(): string {
  return join(getDataDir(), 'seed-usage.json');
}

export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Bytes recorded for today; a stored count from an earlier day reads as 0. */
export function bytesAddedToday(): number {
  const saved = safeReadJson<Partial<SeedUsage>>(usagePath(), {});
  return saved.date === today() && typeof saved.bytes === 'number' ? saved.bytes : 0;
}

export function recordBytesAdded(bytes: number): number {
  const total = bytesAddedToday() + Math.max(0, Math.round(bytes));
  atomicWriteJson(usagePath(), { date: today(), bytes: total });
  return total;
}
