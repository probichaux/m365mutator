import { describe, it, expect, vi } from 'vitest';

// Mock the Graph layers so mutateDeletions can run without a tenant.
vi.mock('../graph/mail.js', () => ({
  listMessagesByFilter: vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../graph/calendar.js', () => ({
  listEventsByFilter: vi.fn().mockResolvedValue([{ id: 'e1' }]),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../graph/files.js', () => ({
  listOneDriveItemsByDate: vi.fn().mockResolvedValue([{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }]),
  deleteOneDriveFile: vi.fn().mockResolvedValue(undefined),
}));

import { listMessagesByFilter, deleteMessage } from '../graph/mail.js';
import { listEventsByFilter } from '../graph/calendar.js';
import {
  scopeToRange, buildDateFilter, isValidDate, mutateDeletions,
} from './deletion-mutate.js';

describe('isValidDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isValidDate('2025-01-01')).toBe(true);
    expect(isValidDate('2025-12-31')).toBe(true);
  });
  it('rejects malformed or non-string values', () => {
    expect(isValidDate('2025-1-1')).toBe(false);
    expect(isValidDate('01/01/2025')).toBe(false);
    expect(isValidDate('2025-13-40')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
    expect(isValidDate(20250101)).toBe(false);
  });
});

describe('scopeToRange', () => {
  it('produces inclusive UTC bounds at day edges', () => {
    expect(scopeToRange('all')).toEqual({});
    expect(scopeToRange('after', '2025-01-01')).toEqual({ afterIso: '2025-01-01T00:00:00Z' });
    expect(scopeToRange('before', undefined, '2025-06-30')).toEqual({ beforeIso: '2025-06-30T23:59:59Z' });
    expect(scopeToRange('between', '2025-01-01', '2025-06-30')).toEqual({
      afterIso: '2025-01-01T00:00:00Z',
      beforeIso: '2025-06-30T23:59:59Z',
    });
  });
});

describe('buildDateFilter', () => {
  it('returns undefined for an open range', () => {
    expect(buildDateFilter('receivedDateTime', {})).toBeUndefined();
  });
  it('joins bounds with and', () => {
    expect(buildDateFilter('receivedDateTime', { afterIso: '2025-01-01T00:00:00Z' }))
      .toBe('receivedDateTime ge 2025-01-01T00:00:00Z');
    expect(buildDateFilter('createdDateTime', { afterIso: 'A', beforeIso: 'B' }))
      .toBe('createdDateTime ge A and createdDateTime le B');
  });
});

describe('mutateDeletions', () => {
  it('deletes matches across every user × workload pair', async () => {
    const run = await mutateDeletions(['a@x.com', 'b@x.com'], ['mail', 'calendar'], 'all');
    expect(run.users).toBe(2);
    expect(run.results.length).toBe(4); // 2 users × 2 workloads
    // 2 users × (2 mail + 1 event) = 6 matched / deleted
    expect(run.matched).toBe(6);
    expect(run.deleted).toBe(6);
    expect(run.failed).toBe(0);
    expect(run.results.every(r => r.ok)).toBe(true);
  });

  it('passes a receivedDateTime filter for mail and createdDateTime for calendar', async () => {
    await mutateDeletions(['a@x.com'], ['mail', 'calendar'], 'after', '2025-01-01');
    expect(listMessagesByFilter).toHaveBeenCalledWith('a@x.com', 'receivedDateTime ge 2025-01-01T00:00:00Z');
    expect(listEventsByFilter).toHaveBeenCalledWith('a@x.com', 'createdDateTime ge 2025-01-01T00:00:00Z');
  });

  it('counts per-item delete failures without aborting the pair', async () => {
    vi.mocked(deleteMessage)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const run = await mutateDeletions(['a@x.com'], ['mail'], 'all');
    expect(run.matched).toBe(2);
    expect(run.deleted).toBe(1);
    expect(run.failed).toBe(1);
    expect(run.results[0].ok).toBe(false);
  });
});
