import { describe, it, expect, vi } from 'vitest';

// Mock the Graph + text layers so mutateCalendar can run without a tenant.
vi.mock('../graph/calendar.js', () => ({
  createEvent: vi.fn().mockResolvedValue({ id: 'evt1' }),
  getWorkingHours: vi.fn().mockResolvedValue(null), // → DEFAULT_WORKING_HOURS
}));
vi.mock('./random-text.js', () => ({
  generateText: vi.fn().mockResolvedValue('subject text'),
  subjectPrompt: () => 's',
}));

import {
  pickCalendarOp, pickEventWindow, mutateCalendar, DEFAULT_WORKING_HOURS, CalendarOp,
} from './calendar-mutate.js';
import { WorkingHours } from '../graph/calendar.js';

describe('pickCalendarOp', () => {
  it('splits 50/50 at the midpoint', () => {
    expect(pickCalendarOp(() => 0)).toBe('meeting');
    expect(pickCalendarOp(() => 0.499)).toBe('meeting');
    expect(pickCalendarOp(() => 0.5)).toBe('appointment');
    expect(pickCalendarOp(() => 0.999)).toBe('appointment');
  });

  it('is roughly balanced over an even sweep', () => {
    const counts: Record<CalendarOp, number> = { meeting: 0, appointment: 0 };
    const n = 20000;
    for (let i = 0; i < n; i++) counts[pickCalendarOp(() => i / n)]++;
    expect(counts.meeting / n).toBeCloseTo(0.5, 2);
    expect(counts.appointment / n).toBeCloseTo(0.5, 2);
  });
});

describe('pickEventWindow', () => {
  // Monday 2026-07-06 (getDay() === 1) as the reference "now".
  const now = new Date(2026, 6, 6, 12, 0, 0);

  it('picks a 30-minute slot on a weekday inside working hours', () => {
    const w = pickEventWindow(DEFAULT_WORKING_HOURS, now, () => 0);
    // rand=0 → first candidate day (Tue 2026-07-07) and earliest start (08:00).
    expect(w.start).toBe('2026-07-07T08:00:00');
    expect(w.end).toBe('2026-07-07T08:30:00');
    expect(w.timeZone).toBe('UTC');
  });

  it('keeps the latest start within [end − 30min]', () => {
    const w = pickEventWindow(DEFAULT_WORKING_HOURS, now, () => 0.999);
    // 08:00–17:00 → latest start 16:30, end 17:00.
    expect(w.start.endsWith('T16:30:00')).toBe(true);
    expect(w.end.endsWith('T17:00:00')).toBe(true);
  });

  it('only ever lands on an allowed working day', () => {
    for (let i = 0; i < 200; i++) {
      const w = pickEventWindow(DEFAULT_WORKING_HOURS, now, () => i / 200);
      const day = new Date(`${w.start}Z`).getUTCDay();
      expect(day).toBeGreaterThanOrEqual(1); // Mon
      expect(day).toBeLessThanOrEqual(5);    // Fri
    }
  });

  it('honours a custom working-hours window and time zone', () => {
    const wh: WorkingHours = {
      daysOfWeek: ['wednesday'],
      startTime: '09:00:00.0000000',
      endTime: '10:00:00.0000000',
      timeZone: { name: 'Pacific Standard Time' },
    };
    const w = pickEventWindow(wh, now, () => 0);
    // Only Wednesdays allowed; first one after Mon 07-06 is Wed 07-08.
    expect(w.start).toBe('2026-07-08T09:00:00');
    expect(w.timeZone).toBe('Pacific Standard Time');
  });
});

describe('mutateCalendar runs', () => {
  it('performs runs × mailboxes actions', async () => {
    const run = await mutateCalendar(['a@x.com', 'b@x.com'], 3);
    expect(run.runs).toBe(3);
    expect(run.totalActions).toBe(6);
    expect(run.ok).toBe(6);
    expect(run.failed).toBe(0);
    expect(run.truncated).toBe(false);
  });

  it('defaults to a single pass', async () => {
    const run = await mutateCalendar(['a@x.com', 'b@x.com']);
    expect(run.runs).toBe(1);
    expect(run.totalActions).toBe(2);
  });

  it('clamps runs to [1, 999] and caps the returned sample', async () => {
    expect((await mutateCalendar(['a@x.com'], 0)).runs).toBe(1);
    const big = await mutateCalendar(['a@x.com'], 5000);
    expect(big.runs).toBe(999);
    expect(big.totalActions).toBe(999);
    expect(big.results.length).toBe(500);
    expect(big.truncated).toBe(true);
  });

  it('falls back to an appointment when a lone user has no one to invite', async () => {
    const run = await mutateCalendar(['solo@x.com'], 50);
    expect(run.results.every(r => r.op === 'appointment')).toBe(true);
  });
});
