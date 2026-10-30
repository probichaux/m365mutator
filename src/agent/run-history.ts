// agent-runs.json: summaries of the most recent scheduler cycles. Counts and
// sanitized error text only — never per-item results or content.

import { join } from 'node:path';
import { getDataDir } from '../admin/config-store.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';
import { GraphCredential } from '../graph/graph-client.js';
import { ScheduledWorkload } from './schedule-store.js';

export const MAX_RUNS_KEPT = 50;

export interface WorkloadSummary {
  workload: ScheduledWorkload;
  credential: GraphCredential;
  ok: number;
  failed: number;
  durationMs: number;
  /** Why the whole workload failed (bad input, no targets, upstream error). */
  error?: string;
}

export interface CycleSummary {
  startedAt: string;
  endedAt: string;
  /** blocked = the agent token check failed, so nothing ran. */
  status: 'ok' | 'partial' | 'failed' | 'blocked';
  workloads: WorkloadSummary[];
  error?: string;
}

function getRunsPath(): string {
  return join(getDataDir(), 'agent-runs.json');
}

export function loadRuns(): CycleSummary[] {
  const runs = safeReadJson<unknown>(getRunsPath(), []);
  return Array.isArray(runs) ? runs as CycleSummary[] : [];
}

/** Append a cycle, keeping the newest MAX_RUNS_KEPT. */
export function appendRun(summary: CycleSummary): void {
  atomicWriteJson(getRunsPath(), [...loadRuns(), summary].slice(-MAX_RUNS_KEPT));
}
