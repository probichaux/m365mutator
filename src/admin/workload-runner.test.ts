import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the target store, resolution and every mutator so the engine's own
// validation and dispatch can be tested without a tenant.
vi.mock('./targets-store.js', () => ({ loadTargets: vi.fn() }));
vi.mock('./target-load.js', () => ({ resolveTargetItems: vi.fn() }));
vi.mock('./identity-mutate.js', () => ({ mutateIdentities: vi.fn() }));
vi.mock('./mail-mutate.js', () => ({ mutateMail: vi.fn() }));
vi.mock('./calendar-mutate.js', () => ({ mutateCalendar: vi.fn() }));
vi.mock('./onedrive-mutate.js', () => ({ mutateOneDrive: vi.fn() }));
vi.mock('./sharepoint-mutate.js', () => ({ mutateSharePoint: vi.fn() }));
vi.mock('./deletion-mutate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deletion-mutate.js')>()),
  mutateDeletions: vi.fn(),
}));

import { loadTargets } from './targets-store.js';
import { resolveTargetItems } from './target-load.js';
import { mutateIdentities } from './identity-mutate.js';
import { mutateMail } from './mail-mutate.js';
import { mutateCalendar } from './calendar-mutate.js';
import { mutateOneDrive } from './onedrive-mutate.js';
import { mutateSharePoint } from './sharepoint-mutate.js';
import { mutateDeletions } from './deletion-mutate.js';
import { currentGraphCredential } from '../graph/graph-client.js';
import { parseWorkloadRequest, runWorkload, WorkloadInputError, WORKLOADS } from './workload-runner.js';

const RUN = { results: [], total: 1, succeeded: 1, failed: 0 } as never;

beforeEach(() => {
  vi.clearAllMocks();
  const cfg = { enabled: true, items: ['a'], runStyle: 'explicit', randomPercent: 10 };
  vi.mocked(loadTargets).mockReturnValue(Object.fromEntries(WORKLOADS.map(w => [w, cfg])) as never);
  vi.mocked(resolveTargetItems).mockResolvedValue({ items: ['a', 'b'], pool: 2, runStyle: 'explicit' });
  for (const fn of [mutateIdentities, mutateMail, mutateCalendar, mutateOneDrive, mutateSharePoint, mutateDeletions]) {
    vi.mocked(fn).mockResolvedValue(RUN);
  }
});

describe('parseWorkloadRequest', () => {
  it('defaults runs to 1 when missing or not a finite number', () => {
    expect(parseWorkloadRequest('calendar', {})).toEqual({ workload: 'calendar', runs: 1 });
    expect(parseWorkloadRequest('onedrive', { runs: 'x' })).toEqual({ workload: 'onedrive', runs: 1 });
    expect(parseWorkloadRequest('sharepoint', { runs: Infinity })).toEqual({ workload: 'sharepoint', runs: 1 });
    expect(parseWorkloadRequest('calendar', { runs: 7 })).toEqual({ workload: 'calendar', runs: 7 });
  });

  it('only allows mail deletions when explicitly true', () => {
    expect(parseWorkloadRequest('mail', { runs: 2, allowDeletions: 'true' }))
      .toEqual({ workload: 'mail', runs: 2, allowDeletions: false });
    expect(parseWorkloadRequest('mail', { allowDeletions: true }))
      .toEqual({ workload: 'mail', runs: 1, allowDeletions: true });
  });

  it('tolerates a missing body', () => {
    expect(parseWorkloadRequest('identities', undefined)).toEqual({ workload: 'identities' });
  });

  it.each([
    [{ scope: 'all' }, 'Select at least one workload'],
    [{ workloads: ['teams'], scope: 'all' }, 'Select at least one workload'],
    [{ workloads: ['mail'], scope: 'sometimes' }, 'Invalid deletion scope'],
    [{ workloads: ['mail'], scope: 'after' }, 'A valid start date is required'],
    [{ workloads: ['mail'], scope: 'before', before: 'nope' }, 'A valid end date is required'],
    [{ workloads: ['mail'], scope: 'between', after: '2026-02-01', before: '2026-01-01' },
      'The start date must not be after the end date'],
  ])('rejects invalid deletion input %j', (body, message) => {
    expect(() => parseWorkloadRequest('deletions', body)).toThrow(new WorkloadInputError(message));
  });

  it('keeps only the dates the scope uses and drops unknown workloads', () => {
    expect(parseWorkloadRequest('deletions', {
      workloads: ['calendar', 'teams', 'mail'], scope: 'after', after: '2026-01-01', before: '2026-02-01',
    })).toEqual({
      workload: 'deletions', workloads: ['mail', 'calendar'], scope: 'after', after: '2026-01-01', before: undefined,
    });
  });
});

describe('runWorkload', () => {
  it('resolves the saved targets for the workload and dispatches with the request options', async () => {
    const result = await runWorkload({ workload: 'mail', runs: 3, allowDeletions: true });
    expect(resolveTargetItems).toHaveBeenCalledWith('mail', loadTargets().mail);
    expect(mutateMail).toHaveBeenCalledWith(['a', 'b'], 3, true);
    expect(result).toEqual({ ...(RUN as object), runStyle: 'explicit', pool: 2 });
  });

  it('dispatches each workload to its mutator', async () => {
    await runWorkload({ workload: 'identities' });
    await runWorkload({ workload: 'calendar', runs: 2 });
    await runWorkload({ workload: 'onedrive', runs: 4 });
    await runWorkload({ workload: 'sharepoint', runs: 5 });
    await runWorkload({ workload: 'deletions', workloads: ['onedrive'], scope: 'before', before: '2026-01-01' });
    expect(mutateIdentities).toHaveBeenCalledWith(['a', 'b']);
    expect(mutateCalendar).toHaveBeenCalledWith(['a', 'b'], 2);
    expect(mutateOneDrive).toHaveBeenCalledWith(['a', 'b'], 4);
    expect(mutateSharePoint).toHaveBeenCalledWith(['a', 'b'], 5);
    expect(mutateDeletions).toHaveBeenCalledWith(['a', 'b'], ['onedrive'], 'before', undefined, '2026-01-01');
  });

  it.each([
    ['explicit', 'No SharePoint sites are selected'],
    ['random', 'No SharePoint sites were found in the tenant to sample'],
  ] as const)('throws an input error when %s resolution is empty', async (runStyle, message) => {
    vi.mocked(resolveTargetItems).mockResolvedValue({ items: [], pool: 0, runStyle });
    await expect(runWorkload({ workload: 'sharepoint', runs: 1 })).rejects.toThrow(new WorkloadInputError(message));
    expect(mutateSharePoint).not.toHaveBeenCalled();
  });

  it('runs resolution and the workload under the app credential by default', async () => {
    const seen: string[] = [];
    vi.mocked(resolveTargetItems).mockImplementation(async () => {
      seen.push(`resolve:${currentGraphCredential()}`);
      return { items: ['a'], pool: 1, runStyle: 'explicit' };
    });
    vi.mocked(mutateCalendar).mockImplementation(async () => {
      seen.push(`dispatch:${currentGraphCredential()}`);
      return RUN;
    });
    await runWorkload({ workload: 'calendar', runs: 1 });
    await runWorkload({ workload: 'calendar', runs: 1 }, { directoryCredential: 'agent' });
    await runWorkload({ workload: 'calendar', runs: 1 }, { credential: 'agent', directoryCredential: 'agent' });
    expect(seen).toEqual([
      'resolve:app', 'dispatch:app',
      'resolve:agent', 'dispatch:app',
      'resolve:agent', 'dispatch:agent',
    ]);
    expect(currentGraphCredential()).toBe('app');
  });

  it('propagates upstream failures unchanged', async () => {
    const upstream = new Error('Graph 503');
    vi.mocked(mutateCalendar).mockRejectedValue(upstream);
    await expect(runWorkload({ workload: 'calendar', runs: 1 })).rejects.toBe(upstream);
  });
});
