import { type CalendarEvent, googleCalendarUrl } from './calendar-links';

const base: CalendarEvent = {
  title: 'My 29th birthday',
  startDate: '2027-06-26T18:00:00',
  endDate: '2027-06-26T22:00:00',
  location: 'Sa harong lang',
  isVirtual: false,
  description: 'Food & good vibes',
};

/** Parses the generated link's query string. */
function params(event: CalendarEvent): URLSearchParams {
  const url = googleCalendarUrl(event);
  expect(url).not.toBeNull();
  return new URL(url!).searchParams;
}

describe('googleCalendarUrl', () => {
  it('builds a Google Calendar template link with floating local times', () => {
    const p = params(base);
    expect(p.get('action')).toBe('TEMPLATE');
    expect(p.get('text')).toBe('My 29th birthday');
    expect(p.get('dates')).toBe('20270626T180000/20270626T220000');
    expect(p.get('location')).toBe('Sa harong lang');
    expect(p.get('details')).toBe('Food & good vibes');
  });

  it('assumes a 2-hour event when there is no end date', () => {
    expect(params({ ...base, endDate: null }).get('dates')).toBe(
      '20270626T180000/20270626T200000',
    );
  });

  it('ignores an end date that is not after the start', () => {
    expect(params({ ...base, endDate: '2027-06-26T17:00:00' }).get('dates')).toBe(
      '20270626T180000/20270626T200000',
    );
  });

  it('uses "Online" as the location for virtual events', () => {
    expect(params({ ...base, isVirtual: true, location: null }).get('location')).toBe('Online');
  });

  it('omits empty optional fields', () => {
    const p = params({ ...base, location: null, description: null });
    expect(p.has('location')).toBe(false);
    expect(p.has('details')).toBe(false);
  });

  it('returns null for an unparseable start date', () => {
    expect(googleCalendarUrl({ ...base, startDate: 'not a date' })).toBeNull();
  });
});
