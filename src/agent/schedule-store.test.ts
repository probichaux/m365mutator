import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRequest, loadSchedule, resolveRelativeDate, sanitizeSchedule } from './schedule-store.js';
import { parseWorkloadRequest } from '../admin/workload-runner.js';

const NOW = Date.parse('2026-10-30T12:00:00Z');

describe('sanitizeSchedule', () => {
  it('returns a disabled default for junk input', () => {
    const { schedule, errors } = sanitizeSchedule('nope');
    expect(schedule.enabled).toBe(false);
    expect(schedule.intervalMinutes).toBe(60);
    expect(errors).toEqual([]);
  });

  it('clamps numbers and drops unknown keys', () => {
    const { schedule } = sanitizeSchedule({
      enabled: true, intervalMinutes: 1, jitterMinutes: 99, extra: 'x',
      workloads: { mail: { enabled: true, runs: 1e6, allowDeletions: 'yes' }, teams: { enabled: true } },
    });
    expect(schedule.intervalMinutes).toBe(5);
    expect(schedule.jitterMinutes).toBe(2);
    expect(schedule.workloads.mail).toEqual({ enabled: true, runs: 100, allowDeletions: false });
    expect(schedule).not.toHaveProperty('extra');
    expect(schedule.workloads).not.toHaveProperty('teams');
  });

  it('defaults every workload credential to the app registration', () => {
    const { schedule } = sanitizeSchedule({ credentials: { mail: 'agent', calendar: 'robot' } });
    expect(schedule.credentials).toEqual({
      mail: 'agent', calendar: 'app', onedrive: 'app', sharepoint: 'app', deletions: 'app',
    });
  });

  it('rejects Identities', () => {
    const { errors } = sanitizeSchedule({ workloads: { identities: { enabled: true } } });
    expect(errors).toEqual([expect.stringContaining('Identities')]);
  });

  it('rejects recurring Deletions without acknowledgeDestructive', () => {
    const base = { enabled: true, workloads: ['mail'], scope: 'before', before: '-30d' };
    expect(sanitizeSchedule({ workloads: { deletions: base } }).errors)
      .toEqual([expect.stringContaining('acknowledgeDestructive')]);
    expect(sanitizeSchedule({ workloads: { deletions: { ...base, acknowledgeDestructive: true } } }).errors)
      .toEqual([]);
  });

  it('rejects invalid Deletions input with the engine\'s own message', () => {
    const { errors } = sanitizeSchedule({
      workloads: { deletions: { enabled: true, acknowledgeDestructive: true, workloads: [], scope: 'all' } },
    });
    expect(errors).toEqual(['deletions: Select at least one workload']);
  });

  it.each([
    [{ timeZone: 'Mars/Olympus', days: ['mon'], start: '08:00', end: '18:00' }, 'not a valid IANA time zone'],
    [{ timeZone: 'UTC', days: [], start: '08:00', end: '18:00' }, 'at least one day'],
    [{ timeZone: 'UTC', days: ['mon'], start: '8am', end: '18:00' }, 'HH:MM'],
    [{ timeZone: 'UTC', days: ['mon'], start: '08:00', end: '08:00' }, 'must differ'],
  ])('rejects a bad active window %j', (activeWindow, message) => {
    expect(sanitizeSchedule({ activeWindow }).errors).toEqual([expect.stringContaining(message)]);
  });

  it('normalizes day names', () => {
    const { schedule, errors } = sanitizeSchedule({
      activeWindow: { timeZone: 'Europe/Copenhagen', days: ['FRI', 'mon', 'funday'], start: '22:00', end: '06:00' },
    });
    expect(errors).toEqual([]);
    expect(schedule.activeWindow?.days).toEqual(['mon', 'fri']);
  });
});

describe('relative dates', () => {
  it('resolves days and weeks against the run time', () => {
    expect(resolveRelativeDate('-30d', NOW)).toBe('2026-09-30');
    expect(resolveRelativeDate('-2w', NOW)).toBe('2026-10-16');
    expect(resolveRelativeDate('2026-01-01', NOW)).toBe('2026-01-01');
    expect(resolveRelativeDate(undefined, NOW)).toBeUndefined();
  });
});

describe('buildRequest', () => {
  it('produces the same request the admin route would for the same input', () => {
    const { schedule } = sanitizeSchedule({
      workloads: {
        mail: { enabled: true, runs: 3, allowDeletions: true },
        sharepoint: { enabled: true, runs: 2 },
      },
    });
    expect(buildRequest('mail', schedule, NOW)).toEqual(parseWorkloadRequest('mail', { runs: 3, allowDeletions: true }));
    expect(buildRequest('sharepoint', schedule, NOW)).toEqual(parseWorkloadRequest('sharepoint', { runs: 2 }));
  });

  it('resolves relative Deletions dates at build time', () => {
    const { schedule } = sanitizeSchedule({
      workloads: {
        deletions: {
          enabled: true, acknowledgeDestructive: true, workloads: ['mail', 'onedrive'], scope: 'between',
          after: '-2w', before: '-1d',
        },
      },
    });
    expect(buildRequest('deletions', schedule, NOW)).toEqual({
      workload: 'deletions', workloads: ['mail', 'onedrive'], scope: 'between', after: '2026-10-16', before: '2026-10-29',
    });
  });
});

describe('loadSchedule', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'schedule-'));
    process.env.M365MUTATOR_DATA_DIR = dir;
    delete process.env.M365MUTATOR_SCHEDULE_JSON;
  });

  afterEach(() => {
    process.env = { ...saved };
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the disabled default when there is no file', () => {
    expect(loadSchedule()).toMatchObject({ source: 'default', errors: [], schedule: { enabled: false } });
  });

  it('reads schedule.json from the data dir', () => {
    writeFileSync(join(dir, 'schedule.json'), JSON.stringify({ enabled: true, intervalMinutes: 30 }));
    expect(loadSchedule()).toMatchObject({ source: 'file', schedule: { enabled: true, intervalMinutes: 30 } });
  });

  it('prefers the app setting, and reports bad JSON there', () => {
    writeFileSync(join(dir, 'schedule.json'), JSON.stringify({ enabled: true }));
    process.env.M365MUTATOR_SCHEDULE_JSON = JSON.stringify({ enabled: true, intervalMinutes: 15 });
    expect(loadSchedule()).toMatchObject({ source: 'env', schedule: { intervalMinutes: 15 } });
    process.env.M365MUTATOR_SCHEDULE_JSON = '{';
    expect(loadSchedule()).toMatchObject({ source: 'env', errors: [expect.stringContaining('not valid JSON')] });
  });
});
