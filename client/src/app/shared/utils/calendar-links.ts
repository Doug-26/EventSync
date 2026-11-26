/** The event fields a calendar link needs. */
export interface CalendarEvent {
  readonly title: string;
  /** Timezone-less local date-time, as the API returns it (e.g. `2027-06-26T18:00:00`). */
  readonly startDate: string;
  readonly endDate: string | null;
  readonly location: string | null;
  readonly isVirtual: boolean;
  readonly description: string | null;
}

/** Length assumed for an event with no end time. */
const DEFAULT_DURATION_HOURS = 2;

/**
 * Builds a Google Calendar "add event" link.
 *
 * `.ics` downloads often fail in the in-app browsers of chat apps, where most
 * guests open invites, while this opens Google Calendar directly. Times are
 * sent as floating local times (no `Z`), matching the API's timezone-less event
 * dates, so the event lands at the same wall-clock time the organizer entered.
 * Returns null when the start date can't be parsed.
 */
export function googleCalendarUrl(event: CalendarEvent): string | null {
  const start = new Date(event.startDate);
  if (Number.isNaN(start.getTime())) return null;
  let end = event.endDate ? new Date(event.endDate) : null;
  if (!end || Number.isNaN(end.getTime()) || end <= start) {
    end = new Date(start.getTime() + DEFAULT_DURATION_HOURS * 3_600_000);
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toFloating(start)}/${toFloating(end)}`,
  });
  const location = event.isVirtual ? 'Online' : event.location;
  if (location) params.set('location', location);
  if (event.description) params.set('details', event.description.slice(0, 1000));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Formats a date as `YYYYMMDDTHHmmss` in local time. */
function toFloating(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
