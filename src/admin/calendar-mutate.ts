// Perform one 50/50 random calendar operation per selected user.

import {
  createEvent, getWorkingHours, CalendarEvent, WorkingHours,
} from '../graph/calendar.js';
import { generateText, subjectPrompt } from './random-text.js';
import { sanitizeUpstreamError } from './connectivity.js';
import { logger } from '../logger/logger.js';

export type CalendarOp = 'meeting' | 'appointment';

export interface CalendarResult {
  /** The organizing mailbox (UPN). */
  item: string;
  /** The operation actually performed (a meeting with no invitee falls back to an appointment). */
  op: CalendarOp;
  ok: boolean;
  /** Human-readable summary, e.g. "invited bob@… on 2026-07-10T09:30:00". */
  detail?: string;
  error?: string;
}

export interface CalendarRun {
  /** Number of passes performed (one weighted action per mailbox per pass). */
  runs: number;
  /** runs × mailboxes — the total actions attempted. */
  totalActions: number;
  ok: number;
  failed: number;
  /** A capped sample of per-action results for display. */
  results: CalendarResult[];
  /** True when more actions ran than are included in `results`. */
  truncated: boolean;
}

export const MAX_RUNS = 999;
/** Cap on per-action results returned so a large run does not ship a huge payload. */
const RESULT_SAMPLE_CAP = 500;
const MUTATE_CONCURRENCY = 5;

const EVENT_DURATION_MINUTES = 30;
/** Events are scheduled on a random working day within this many days ahead. */
const WINDOW_DAYS = 14;
/** Start times are snapped to this granularity within the working-hours window. */
const SLOT_MINUTES = 15;

/** Used when a mailbox exposes no working hours (or the read permission is missing). */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  startTime: '08:00:00.0000000',
  endTime: '17:00:00.0000000',
  timeZone: { name: 'UTC' },
};

const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/** Pick one of the two operations, 50/50. `rand` returns [0, 1); injectable for tests. */
export function pickCalendarOp(rand: () => number = Math.random): CalendarOp {
  return rand() < 0.5 ? 'meeting' : 'appointment';
}

/** Minutes since midnight from a Graph time-of-day string like "08:00:00.0000000". */
function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

function formatLocal(year: number, month1: number, day: number, minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month1)}-${pad(day)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}

export interface EventWindow {
  /** Local dateTime string (no offset), to be paired with `timeZone`. */
  start: string;
  end: string;
  timeZone: string;
}

/**
 * Choose a 30-minute slot on a random working day within the next WINDOW_DAYS
 * days, at a random start time inside the working-hours window. Returns local
 * dateTime strings paired with the working-hours time zone. `now` and `rand`
 * are injectable for tests.
 */
export function pickEventWindow(
  wh: WorkingHours,
  now: Date = new Date(),
  rand: () => number = Math.random,
): EventWindow {
  const dayNames = wh.daysOfWeek?.length ? wh.daysOfWeek : DEFAULT_WORKING_HOURS.daysOfWeek;
  const allowed = new Set(
    dayNames.map(d => DAY_INDEX[d.toLowerCase()]).filter(d => d !== undefined),
  );
  if (allowed.size === 0) [1, 2, 3, 4, 5].forEach(d => allowed.add(d));

  const candidates: Date[] = [];
  for (let offset = 1; offset <= WINDOW_DAYS; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (allowed.has(d.getDay())) candidates.push(d);
  }
  if (candidates.length === 0) {
    candidates.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  }
  const day = candidates[Math.floor(rand() * candidates.length)];

  const startMin = parseTimeToMinutes(wh.startTime);
  const endMin = parseTimeToMinutes(wh.endTime);
  const latestStart = Math.max(startMin, endMin - EVENT_DURATION_MINUTES);
  const slots = Math.max(1, Math.floor((latestStart - startMin) / SLOT_MINUTES) + 1);
  const startMinutes = startMin + Math.floor(rand() * slots) * SLOT_MINUTES;
  const endMinutes = startMinutes + EVENT_DURATION_MINUTES;

  const y = day.getFullYear();
  const mo = day.getMonth() + 1;
  const da = day.getDate();
  return {
    start: formatLocal(y, mo, da, startMinutes),
    end: formatLocal(y, mo, da, endMinutes),
    timeZone: wh.timeZone?.name || 'UTC',
  };
}

async function mutateOne(actor: string, others: string[]): Promise<CalendarResult> {
  const chosen = pickCalendarOp();
  // A meeting needs someone to invite; with no counterpart, do an appointment instead.
  const op: CalendarOp = chosen === 'meeting' && others.length === 0 ? 'appointment' : chosen;
  try {
    const wh = (await getWorkingHours(actor)) ?? DEFAULT_WORKING_HOURS;
    const when = pickEventWindow(wh);
    const subject = await generateText(subjectPrompt());
    const event: CalendarEvent = {
      subject,
      start: { dateTime: when.start, timeZone: when.timeZone },
      end: { dateTime: when.end, timeZone: when.timeZone },
    };
    if (op === 'meeting') {
      const invitee = others[Math.floor(Math.random() * others.length)];
      event.attendees = [{ emailAddress: { address: invitee }, type: 'required' }];
      await createEvent(actor, event);
      return { item: actor, op, ok: true, detail: `invited ${invitee} on ${when.start}` };
    }
    await createEvent(actor, event);
    return { item: actor, op, ok: true, detail: `appointment on ${when.start}` };
  } catch (err) {
    const error = sanitizeUpstreamError(err);
    logger.warn(`[CAL] ${op} failed for "${actor}": ${error}`);
    return { item: actor, op, ok: false, error };
  }
}

/**
 * Perform `runs` passes; each pass runs one 50/50 calendar operation per selected
 * user. All actions (runs × mailboxes) are scheduled through a single bounded
 * worker pool, so one failure does not abort the rest. Returns totals plus a
 * capped sample of individual results.
 */
export async function mutateCalendar(items: string[], runs = 1): Promise<CalendarRun> {
  const passes = Math.min(MAX_RUNS, Math.max(1, Math.round(runs)));
  logger.info(`[CAL] Mutating ${items.length} calendar(s) × ${passes} pass(es)`);

  // Precompute each actor's counterparts once; flatten passes into one task list.
  const othersByActor = new Map(items.map(a => [a, items.filter(i => i !== a)]));
  const actors: string[] = [];
  for (let p = 0; p < passes; p++) actors.push(...items);

  const results: CalendarResult[] = new Array(actors.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(MUTATE_CONCURRENCY, actors.length) }, async () => {
    while (next < actors.length) {
      const index = next++;
      const actor = actors[index];
      results[index] = await mutateOne(actor, othersByActor.get(actor) ?? []);
    }
  });
  await Promise.all(workers);

  const ok = results.filter(r => r.ok).length;
  return {
    runs: passes,
    totalActions: results.length,
    ok,
    failed: results.length - ok,
    results: results.slice(0, RESULT_SAMPLE_CAP),
    truncated: results.length > RESULT_SAMPLE_CAP,
  };
}
