import { describe, it, expect } from 'vitest';
import { clampToWindow, computeNextRun, inWindow, ActiveWindow } from './next-run.js';

const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

// America/Chicago is UTC-5 (CDT) in summer and UTC-6 (CST) in winter.
const weekdays: ActiveWindow = {
  timeZone: 'America/Chicago', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '08:00', end: '18:00',
};

describe('computeNextRun', () => {
  it('adds the interval with no jitter or window', () => {
    expect(computeNextRun(0, { intervalMinutes: 60, jitterMinutes: 0 })).toBe(60 * MIN);
  });

  it('keeps jitter within ±jitterMinutes', () => {
    const timing = { intervalMinutes: 60, jitterMinutes: 10 };
    expect(computeNextRun(0, timing, () => 0)).toBe(50 * MIN);
    expect(computeNextRun(0, timing, () => 0.5)).toBe(60 * MIN);
    expect(computeNextRun(0, timing, () => 0.999999)).toBeLessThanOrEqual(70 * MIN);
  });

  it('pushes a candidate outside the window to the next window start', () => {
    // Fri 2026-07-10 17:30 CDT + 60 min = 18:30, past the window → Mon 08:00 CDT.
    const next = computeNextRun(at('2026-07-10T22:30:00Z'), { intervalMinutes: 60, jitterMinutes: 0, activeWindow: weekdays });
    expect(iso(next)).toBe('2026-07-13T13:00:00.000Z');
  });

  it('keeps a candidate already inside the window', () => {
    const next = computeNextRun(at('2026-07-08T15:00:00Z'), { intervalMinutes: 30, jitterMinutes: 0, activeWindow: weekdays });
    expect(iso(next)).toBe('2026-07-08T15:30:00.000Z');
  });
});

describe('clampToWindow', () => {
  const overnight: ActiveWindow = { timeZone: 'America/Chicago', days: ['fri'], start: '22:00', end: '06:00' };

  it('handles a window that crosses midnight', () => {
    // Sat 02:00 CDT is inside Friday's 22:00–06:00 window.
    expect(iso(clampToWindow(at('2026-07-11T07:00:00Z'), overnight))).toBe('2026-07-11T07:00:00.000Z');
    // Sat 07:00 CDT is after it → next Friday 22:00 CDT.
    expect(iso(clampToWindow(at('2026-07-11T12:00:00Z'), overnight))).toBe('2026-07-18T03:00:00.000Z');
    // Fri 21:00 CDT → 22:00 the same evening.
    expect(iso(clampToWindow(at('2026-07-11T02:00:00Z'), overnight))).toBe('2026-07-11T03:00:00.000Z');
  });

  it('uses the right UTC offset across DST changes', () => {
    // US DST ended Sun 2026-11-01. Fri 2026-10-30 19:00 CDT → Mon 2026-11-02 08:00 CST (14:00Z).
    expect(iso(clampToWindow(at('2026-10-31T00:00:00Z'), weekdays))).toBe('2026-11-02T14:00:00.000Z');
    // DST started Sun 2026-03-08. Fri 2026-03-06 19:00 CST → Mon 2026-03-09 08:00 CDT (13:00Z).
    expect(iso(clampToWindow(at('2026-03-07T01:00:00Z'), weekdays))).toBe('2026-03-09T13:00:00.000Z');
  });

  it('lands just after a DST gap for a start time that does not exist', () => {
    const gap: ActiveWindow = { timeZone: 'America/Chicago', days: ['sun'], start: '02:30', end: '04:00' };
    // 02:30 doesn't exist on 2026-03-08, so the window opens an hour later, at 03:30 CDT (08:30Z).
    expect(iso(clampToWindow(at('2026-03-08T06:00:00Z'), gap))).toBe('2026-03-08T08:30:00.000Z');
  });

  it('takes the first occurrence of a repeated time when DST ends', () => {
    const repeat: ActiveWindow = { timeZone: 'America/Chicago', days: ['sun'], start: '01:30', end: '05:00' };
    // 01:30 happens twice on 2026-11-01; the first is 01:30 CDT (06:30Z).
    expect(iso(clampToWindow(at('2026-11-01T04:00:00Z'), repeat))).toBe('2026-11-01T06:30:00.000Z');
  });

  it('returns null when no day is enabled', () => {
    expect(clampToWindow(0, { ...weekdays, days: [] })).toBeNull();
  });

  it('inWindow reports membership', () => {
    expect(inWindow(at('2026-07-08T15:00:00Z'), weekdays)).toBe(true);
    expect(inWindow(at('2026-07-11T15:00:00Z'), weekdays)).toBe(false);
    expect(inWindow(0)).toBe(true);
  });
});
