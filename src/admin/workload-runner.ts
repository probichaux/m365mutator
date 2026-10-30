import { loadTargets } from './targets-store.js';
import { resolveTargetItems, ResolvedTargets } from './target-load.js';
import { mutateIdentities, MutationRun as IdentityRun } from './identity-mutate.js';
import { mutateMail, MailRun } from './mail-mutate.js';
import { mutateCalendar, CalendarRun } from './calendar-mutate.js';
import { mutateOneDrive, OneDriveRun } from './onedrive-mutate.js';
import { mutateSharePoint, SharePointRun } from './sharepoint-mutate.js';
import {
  mutateDeletions, DELETION_WORKLOADS, DELETION_SCOPES,
  DeletionWorkload, DeletionScope, DeletionRun, isValidDate,
} from './deletion-mutate.js';

// Shared mutation engine: validation, target resolution and dispatch for every
// workload. The admin routes and the agent scheduler both call runWorkload, so
// the two paths behave identically for the same input.

export const WORKLOADS = ['identities', 'mail', 'calendar', 'onedrive', 'sharepoint', 'deletions'] as const;
export type Workload = (typeof WORKLOADS)[number];

export type WorkloadRequest =
  | { workload: 'identities' }
  | { workload: 'mail'; runs: number; allowDeletions: boolean }
  | { workload: 'calendar' | 'onedrive' | 'sharepoint'; runs: number }
  | {
    workload: 'deletions';
    workloads: DeletionWorkload[];
    scope: DeletionScope;
    after?: string;
    before?: string;
  };

type Run = IdentityRun | MailRun | CalendarRun | OneDriveRun | SharePointRun | DeletionRun;
export type WorkloadResult = Run & Pick<ResolvedTargets, 'runStyle' | 'pool'>;

/** Bad caller input (maps to HTTP 400). Upstream Graph failures propagate as-is. */
export class WorkloadInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkloadInputError';
  }
}

// Error shown when target resolution yields nothing: [random, explicit].
const EMPTY_TARGET_MESSAGES: Record<Workload, [string, string]> = {
  identities: ['No users were found in the tenant to sample', 'No identities are selected'],
  mail: ['No mailboxes were found in the tenant to sample', 'No mailboxes are selected'],
  calendar: ['No mailboxes were found in the tenant to sample', 'No mailboxes are selected'],
  onedrive: ['No OneDrive users were found in the tenant to sample', 'No OneDrive users are selected'],
  sharepoint: ['No SharePoint sites were found in the tenant to sample', 'No SharePoint sites are selected'],
  deletions: ['No users were found in the tenant to sample', 'No users are selected'],
};

function parseRuns(runs: unknown): number {
  return typeof runs === 'number' && Number.isFinite(runs) ? runs : 1;
}

/**
 * Build a validated WorkloadRequest from an untrusted request body.
 * Throws WorkloadInputError on invalid input.
 */
export function parseWorkloadRequest(workload: Workload, body: unknown): WorkloadRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  switch (workload) {
    case 'identities':
      return { workload };
    case 'mail':
      return { workload, runs: parseRuns(b.runs), allowDeletions: b.allowDeletions === true };
    case 'calendar':
    case 'onedrive':
    case 'sharepoint':
      return { workload, runs: parseRuns(b.runs) };
    case 'deletions':
      return parseDeletionRequest(b);
  }
}

function parseDeletionRequest(b: Record<string, unknown>): WorkloadRequest {
  const { workloads, scope, after, before } = b;
  const selected = Array.isArray(workloads)
    ? DELETION_WORKLOADS.filter(w => (workloads as unknown[]).includes(w))
    : [];
  if (selected.length === 0) {
    throw new WorkloadInputError('Select at least one workload');
  }
  if (!DELETION_SCOPES.includes(scope as DeletionScope)) {
    throw new WorkloadInputError('Invalid deletion scope');
  }
  const scopeVal = scope as DeletionScope;
  const needsAfter = scopeVal === 'after' || scopeVal === 'between';
  const needsBefore = scopeVal === 'before' || scopeVal === 'between';
  if (needsAfter && !isValidDate(after)) {
    throw new WorkloadInputError('A valid start date is required');
  }
  if (needsBefore && !isValidDate(before)) {
    throw new WorkloadInputError('A valid end date is required');
  }
  if (scopeVal === 'between' && String(after) > String(before)) {
    throw new WorkloadInputError('The start date must not be after the end date');
  }
  return {
    workload: 'deletions',
    workloads: selected,
    scope: scopeVal,
    after: needsAfter ? String(after) : undefined,
    before: needsBefore ? String(before) : undefined,
  };
}

/**
 * Resolve the saved targets for the workload and run it.
 * Throws WorkloadInputError when there's nothing to act on.
 */
export async function runWorkload(req: WorkloadRequest): Promise<WorkloadResult> {
  // Explicit → the saved list; random → a fresh random % of the tenant's set.
  const resolved = await resolveTargetItems(req.workload, loadTargets()[req.workload]);
  if (resolved.items.length === 0) {
    const [randomMsg, explicitMsg] = EMPTY_TARGET_MESSAGES[req.workload];
    throw new WorkloadInputError(resolved.runStyle === 'random' ? randomMsg : explicitMsg);
  }
  const run = await dispatch(req, resolved.items);
  return { ...run, runStyle: resolved.runStyle, pool: resolved.pool };
}

function dispatch(req: WorkloadRequest, items: string[]): Promise<Run> {
  switch (req.workload) {
    case 'identities':
      return mutateIdentities(items);
    case 'mail':
      return mutateMail(items, req.runs, req.allowDeletions);
    case 'calendar':
      return mutateCalendar(items, req.runs);
    case 'onedrive':
      return mutateOneDrive(items, req.runs);
    case 'sharepoint':
      return mutateSharePoint(items, req.runs);
    case 'deletions':
      return mutateDeletions(items, req.workloads, req.scope, req.after, req.before);
  }
}
