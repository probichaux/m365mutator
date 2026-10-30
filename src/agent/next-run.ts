// Pure next-run math for the agent scheduler: interval, then jitter, then the
// active-window clamp. No timers here, so it can be tested with fixed clocks.

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface ActiveWindow {
  /** IANA time zone, e.g. "America/Chicago". */
  timeZone: string;
  /** Days on which the window *starts*; a window past midnight ends the next day. */
  days: Weekday[];
  /** Local "HH:MM". `end` before `start` means the window crosses midnight. */
  start: string;
  end: string;
}

export interface Timing {
  intervalMinutes: number;
  jitterMinutes: number;
  activeWindow?: ActiveWindow;
}

const MINUTE = 60_000;

interface LocalParts {
  year: number; month: number; day: number; hour: number; minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(instant: number, timeZone: string): LocalParts {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    });
    formatters.set(timeZone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute,
  };
}

function offsetAt(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(instant / MINUTE) * MINUTE;
}

/**
 * The UTC instant for a local wall-clock time. A time skipped by a DST gap
 * moves forward by the gap; a repeated time takes its first occurrence.
 */
function zonedInstant(timeZone: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const DAY = 86_400_000;
  // The offsets a day either side bracket any transition on this date.
  const candidates = [wall - offsetAt(wall - DAY, timeZone), wall - offsetAt(wall + DAY, timeZone)];
  const exact = candidates.filter(t => {
    const p = localParts(t, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
  });
  return exact.length > 0 ? Math.min(...exact) : Math.max(...candidates);
}

export function parseHhMm(value: string): { h: number; m: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { h: +match[1], m: +match[2] } : null;
}

/**
 * The earliest instant at or after `candidate` that falls inside the window.
 * Returns null when the window can never match (no days).
 */
export function clampToWindow(candidate: number, w: ActiveWindow): number | null {
  const start = parseHhMm(w.start);
  const end = parseHhMm(w.end);
  if (!start || !end || w.days.length === 0) return null;
  const wraps = end.h * 60 + end.m <= start.h * 60 + start.m;
  const base = localParts(candidate, w.timeZone);
  // Start a day early so a window that crossed midnight into today is seen.
  for (let offset = -1; offset <= 8; offset++) {
    // Date.UTC normalizes day overflow, which walks the local calendar.
    const day = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate();
    if (!w.days.includes(WEEKDAYS[day.getUTCDay()])) continue;
    const s = zonedInstant(w.timeZone, y, mo, d, start.h, start.m);
    const endDay = new Date(Date.UTC(y, mo - 1, d + (wraps ? 1 : 0)));
    const e = zonedInstant(w.timeZone, endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), end.h, end.m);
    if (e <= candidate) continue;
    return Math.max(s, candidate);
  }
  return null;
}

/**
 * When the next cycle should start: `from` + interval + uniform jitter in
 * [-jitter, +jitter], pushed forward into the active window if there is one.
 */
export function computeNextRun(from: number, timing: Timing, random: () => number = Math.random): number | null {
  const jitter = (random() * 2 - 1) * timing.jitterMinutes * MINUTE;
  const candidate = from + timing.intervalMinutes * MINUTE + Math.round(jitter);
  return timing.activeWindow ? clampToWindow(candidate, timing.activeWindow) : candidate;
}

/** True when `instant` is inside the window (or there is no window). */
export function inWindow(instant: number, w?: ActiveWindow): boolean {
  return !w || clampToWindow(instant, w) === instant;
}
