// Shared atomic file I/O for config-store.

import { writeFileSync, readFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { logger } from '../logger/logger.js';

export function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
  chmodSync(filePath, 0o600);
}

export function safeReadJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn(`Failed to parse ${filePath}, using fallback`, err);
    return fallback;
  }
}
