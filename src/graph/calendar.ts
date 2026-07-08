import { getGraphClient } from './graph-client.js';

export interface CalendarEvent {
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: { emailAddress: { address: string }; type: 'required' | 'optional' }[];
}

/** A user's working hours, from their mailbox settings. */
export interface WorkingHours {
  /** Lowercase day names, e.g. ["monday", …, "friday"]. */
  daysOfWeek: string[];
  /** Edm.TimeOfDay, e.g. "08:00:00.0000000". */
  startTime: string;
  endTime: string;
  /** Windows or IANA time zone name, e.g. "Pacific Standard Time". */
  timeZone: { name: string };
}

/**
 * The user's configured working hours. Requires the MailboxSettings.Read
 * application permission. Returns null when the mailbox exposes none or the
 * call fails (e.g. the permission is missing), so callers can fall back to a
 * default rather than aborting the run.
 */
export async function getWorkingHours(userId: string): Promise<WorkingHours | null> {
  try {
    const wh = await getGraphClient()
      .api(`/users/${encodeURIComponent(userId)}/mailboxSettings/workingHours`)
      .get();
    if (wh && wh.startTime && wh.endTime) return wh as WorkingHours;
    return null;
  } catch {
    return null;
  }
}

/** Requires the Calendars.ReadWrite application permission. */
export async function createEvent(userId: string, event: CalendarEvent): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/users/${userId}/events`).post(event);
}

/** Requires the Calendars.ReadWrite application permission. */
export async function updateEvent(
  userId: string,
  eventId: string,
  patch: Partial<CalendarEvent>,
): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/users/${userId}/events/${eventId}`).patch(patch);
}

/** Requires the Calendars.ReadWrite application permission. */
export async function deleteEvent(userId: string, eventId: string): Promise<void> {
  await getGraphClient().api(`/users/${userId}/events/${eventId}`).delete();
}
