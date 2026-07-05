import { getGraphClient } from './graph-client.js';

export interface CalendarEvent {
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: { emailAddress: { address: string }; type: 'required' | 'optional' }[];
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
