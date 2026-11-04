import {
  InvalidArgumentError,
  NotFoundError,
  type SyncChangeV1,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { calcom } from './calcom-provider';

type Booking = {
  uid: string;
  start: string;
  end: string;
  status: string;
  updatedAt: string;
  eventTypeId: number;
};

/**
 * A fake Cal.com holding `bookings`. Listing filters and sorts like Cal.com: bounds are
 * inclusive, at most 100 bookings come back, and without a sort the cursor pages by uid.
 */
function fakeCalcom(
  bookings: Booking[],
  eventType: { lengthInMinutes: number; lengthInMinutesOptions?: number[] } = {
    lengthInMinutes: 60,
  },
) {
  const requests: { method: string; url: URL; body: unknown }[] = [];
  const toApi = (booking: Booking) => ({
    id: 1,
    title: 'Intro between Host and Guest',
    hosts: [{ name: 'Host', email: 'host@example.com', timeZone: 'Europe/London' }],
    attendees: [{ name: 'Guest', email: 'guest@example.com', timeZone: 'Asia/Kolkata' }],
    ...booking,
  });
  const calendar = calcom({
    accessToken: 'cal_test',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const text = await request.text();
      const body = text ? JSON.parse(text) : undefined;
      requests.push({ method: request.method, url, body });
      const path = url.pathname.replace('/v2', '');
      const query = url.searchParams;

      if (request.method === 'GET' && path === '/bookings') {
        const limit = Number(query.get('limit'));
        if (limit > 100) return Response.json({ status: 'error' }, { status: 400 });
        const sort = query.has('sortStart')
          ? 'start'
          : query.has('sortUpdatedAt')
            ? 'updatedAt'
            : 'uid';
        const matching = bookings
          .filter((booking) => {
            const type = query.get('eventTypeId');
            return type === null || booking.eventTypeId === Number(type);
          })
          .filter((booking) => booking.start >= (query.get('afterStart') ?? ''))
          .filter((booking) => booking.updatedAt >= (query.get('afterUpdatedAt') ?? ''))
          .filter((booking) => booking.updatedAt <= (query.get('beforeUpdatedAt') ?? '~'))
          .filter((booking) => booking.uid > (query.get('cursor') ?? ''))
          .sort((a, b) => a[sort].localeCompare(b[sort]));
        const data = matching.slice(0, limit);
        return Response.json({
          status: 'success',
          data: data.map(toApi),
          pagination: { hasMore: matching.length > limit, nextCursor: data.at(-1)?.uid ?? null },
        });
      }
      const booking = bookings.find((item) => path.startsWith(`/bookings/${item.uid}`));
      if (request.method === 'GET' && booking) {
        return Response.json({ status: 'success', data: toApi(booking) });
      }
      if (request.method === 'POST' && path.endsWith('/reschedule') && booking) {
        const moved = { ...booking, uid: `${booking.uid}-moved`, start: body.start };
        return Response.json({ status: 'success', data: toApi(moved) });
      }
      if (request.method === 'POST' && path.endsWith('/cancel') && booking) {
        return Response.json({ status: 'success', data: toApi(booking) });
      }
      if (request.method === 'GET' && path === '/event-types') {
        return Response.json({
          status: 'success',
          data: [{ id: 42, title: 'Intro', ...eventType }],
        });
      }
      if (request.method === 'GET' && path.startsWith('/event-types/')) {
        return Response.json({
          status: 'success',
          data: { id: 42, title: 'Intro', ...eventType },
        });
      }
      if (request.method === 'GET' && path === '/me') {
        return Response.json({
          status: 'success',
          data: { email: 'host@example.com', name: 'Host', timeZone: 'Europe/London' },
        });
      }
      if (request.method === 'POST' && path === '/bookings') {
        return Response.json({
          status: 'success',
          data: toApi({
            uid: 'new',
            start: body.start,
            end: new Date(Date.parse(body.start) + 3_600_000).toISOString(),
            status: 'accepted',
            updatedAt: '2026-10-01T00:00:00.000Z',
            eventTypeId: body.eventTypeId,
          }),
        });
      }
      return Response.json({ status: 'error', error: { message: 'missing' } }, { status: 404 });
    },
  });
  return { calendar, requests };
}

const booking = (uid: string, hour: number, extra: Partial<Booking> = {}): Booking => ({
  uid,
  start: `2030-01-07T${String(hour).padStart(2, '0')}:00:00.000Z`,
  end: `2030-01-07T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  status: 'accepted',
  updatedAt: '2026-10-01T00:00:00.000Z',
  eventTypeId: 42,
  ...extra,
});

const window = {
  calendarId: '42',
  timeMin: '2030-01-07T10:00:00Z',
  timeMax: '2030-01-07T20:00:00Z',
  expandRecurring: true,
};

describe('calcom', () => {
  it('pages by start through bookings that share one, and skips cancelled or ended ones', async () => {
    const { calendar } = fakeCalcom([
      booking('ended', 8),
      booking('running', 9, { end: '2030-01-07T11:00:00.000Z' }),
      booking('a', 12),
      booking('b', 12),
      booking('cancelled', 12, { status: 'cancelled' }),
      booking('c', 12),
      booking('d', 15),
      booking('later', 20),
    ]);
    const ids: string[][] = [];
    let pageToken: string | undefined;
    do {
      const page = await calendar.doListEvents({ ...window, pageSize: 2, pageToken });
      ids.push(page.events.map((event) => event.id));
      pageToken = page.nextPageToken;
    } while (pageToken);
    expect(ids.flat()).toEqual(['running', 'a', 'b', 'c', 'd']);
    expect(ids.every((page) => page.length <= 2)).toBe(true);
  });

  it('reads events in the zone they were booked in', async () => {
    const { calendar } = fakeCalcom([booking('a', 12)]);
    const { event } = await calendar.doGetEvent({ calendarId: '42', eventId: 'a' });
    expect(event.start).toEqual({
      dateTime: '2030-01-07T17:30:00+05:30',
      timeZone: 'Asia/Kolkata',
    });
    expect(event.providerMetadata?.calcom).toMatchObject({ eventTypeId: 42, status: 'accepted' });
  });

  it('treats cancelled bookings and bookings of other event types as missing', async () => {
    const { calendar } = fakeCalcom([
      booking('gone', 12, { status: 'cancelled' }),
      booking('a', 12),
    ]);
    await expect(calendar.doGetEvent({ calendarId: '42', eventId: 'gone' })).rejects.toSatisfy(
      NotFoundError.isInstance,
    );
    await expect(calendar.doDeleteEvent({ calendarId: '42', eventId: 'gone' })).rejects.toSatisfy(
      NotFoundError.isInstance,
    );
    await expect(calendar.doGetEvent({ calendarId: '7', eventId: 'a' })).rejects.toSatisfy(
      NotFoundError.isInstance,
    );
  });

  it("pages past Cal.com's limit of 100 bookings a request", async () => {
    const minutes = Array.from({ length: 150 }, (_, index) => index);
    const { calendar } = fakeCalcom(
      minutes.map((minute) =>
        booking(`b${String(minute).padStart(3, '0')}`, 12, {
          start: new Date(Date.parse('2030-01-07T12:00:00Z') + minute * 60_000).toISOString(),
          end: new Date(Date.parse('2030-01-07T13:00:00Z') + minute * 60_000).toISOString(),
        }),
      ),
    );
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await calendar.doListEvents({ ...window, pageToken });
      ids.push(...page.events.map((event) => event.id));
      pageToken = page.nextPageToken;
    } while (pageToken);
    expect(ids).toEqual(minutes.map((minute) => `b${String(minute).padStart(3, '0')}`));
  });

  it('lists bookings that started before the window, as far back as the event type allows', async () => {
    const { calendar } = fakeCalcom(
      [
        booking('retreat', 10, {
          start: '2030-01-05T10:00:00.000Z',
          end: '2030-01-08T10:00:00.000Z',
        }),
      ],
      { lengthInMinutes: 3 * 24 * 60 },
    );
    const { events } = await calendar.doListEvents(window);
    expect(events.map((event) => event.id)).toEqual(['retreat']);
  });

  it.each([100, 101, 250])('syncs %i bookings changed at the same time', async (count) => {
    const tied = Array.from({ length: count }, (_, index) =>
      booking(`t${String(index).padStart(3, '0')}`, 12, { updatedAt: '2026-10-01T00:00:00.000Z' }),
    );
    const { calendar } = fakeCalcom([
      ...tied,
      booking('later', 13, { updatedAt: '2026-10-01T00:00:00.001Z' }),
    ]);
    const round = async (cursor?: string) => {
      const ids: string[] = [];
      let pageToken: string | undefined;
      for (;;) {
        const page = await calendar.doSyncEvents({ calendarId: '42', cursor, pageToken });
        ids.push(
          ...page.changes.map((change) => (change.type === 'upsert' ? change.event.id : '')),
        );
        if (page.nextCursor) return { ids, cursor: page.nextCursor };
        pageToken = page.nextPageToken;
      }
    };
    const initial = await round();
    expect(initial.ids.toSorted()).toEqual([...tied.map((item) => item.uid), 'later'].toSorted());
    expect((await round(initial.cursor)).ids).toEqual([]);
  });

  it('syncs by update time, rereading recent changes without repeating them', async () => {
    const bookings = [
      booking('a', 12, { updatedAt: '2026-10-01T00:00:00.000Z' }),
      booking('b', 13, { status: 'cancelled', updatedAt: '2026-10-01T00:00:30.000Z' }),
    ];
    const { calendar, requests } = fakeCalcom(bookings);
    const sync = async (cursor?: string) => {
      const result = await calendar.doSyncEvents({ calendarId: '42', cursor });
      if (!result.nextCursor) throw new Error('Expected one page.');
      return { changes: result.changes, cursor: result.nextCursor };
    };
    const ids = (changes: SyncChangeV1[]) =>
      changes.map((change) =>
        change.type === 'upsert' ? `upsert ${change.event.id}` : `delete ${change.eventId}`,
      );

    // An initial sync has nothing to delete.
    const initial = await sync();
    expect(ids(initial.changes)).toEqual(['upsert a']);

    expect(ids((await sync(initial.cursor)).changes)).toEqual([]);
    // The reread starts a minute before the newest change seen.
    expect(requests.at(-1)?.url.searchParams.get('afterUpdatedAt')).toBe(
      '2026-09-30T23:59:30.000Z',
    );

    // A change saved late, with an update time before the newest one seen, is still found.
    bookings.push(booking('late', 14, { updatedAt: '2026-10-01T00:00:10.000Z' }));
    bookings[0] = {
      ...booking('a', 12),
      status: 'cancelled',
      updatedAt: '2026-10-01T00:05:00.000Z',
    };
    const next = await sync(initial.cursor);
    expect(ids(next.changes)).toEqual(['upsert late', 'delete a']);
    expect(ids((await sync(next.cursor)).changes)).toEqual([]);

    await expect(calendar.doSyncEvents({ calendarId: '7', cursor: next.cursor })).rejects.toSatisfy(
      InvalidArgumentError.isInstance,
    );
  });

  it('books the event type with the first attendee and the rest as guests', async () => {
    const { calendar, requests } = fakeCalcom([]);
    const { warnings } = await calendar.doCreateEvent({
      calendarId: '42',
      event: {
        title: 'Ignored',
        description: 'Agenda',
        start: { dateTime: '2030-01-07T15:00:00+05:30', timeZone: 'Asia/Kolkata' },
        end: { dateTime: '2030-01-07T16:00:00+05:30', timeZone: 'Asia/Kolkata' },
        attendees: [{ email: 'guest@example.com', name: 'Guest' }, { email: 'other@example.com' }],
      },
    });
    expect(requests.at(-1)?.body).toEqual({
      eventTypeId: 42,
      start: '2030-01-07T09:30:00.000Z',
      attendee: { name: 'Guest', email: 'guest@example.com', timeZone: 'Asia/Kolkata' },
      guests: ['other@example.com'],
      bookingFieldsResponses: { notes: 'Agenda' },
      allowConflicts: true,
      allowBookingOutOfBounds: true,
    });
    expect(warnings).toEqual([expect.objectContaining({ feature: 'title' })]);
  });

  it('rejects lengths the event type does not offer, and bookings without an event type', async () => {
    const { calendar, requests } = fakeCalcom([], {
      lengthInMinutes: 30,
      lengthInMinutesOptions: [30, 60],
    });
    const event = (minutes: number) => ({
      start: { dateTime: '2030-01-07T10:00:00Z', timeZone: 'UTC' },
      end: {
        dateTime: new Date(Date.parse('2030-01-07T10:00:00Z') + minutes * 60_000).toISOString(),
        timeZone: 'UTC',
      },
    });

    await calendar.doCreateEvent({ calendarId: '42', event: event(60) });
    expect(requests.at(-1)?.body).toMatchObject({ lengthInMinutes: 60 });
    await expect(calendar.doCreateEvent({ calendarId: '42', event: event(45) })).rejects.toThrow(
      'Event type 42 books 30, 60 minute slots, not 45 minutes.',
    );
    await expect(
      calendar.doCreateEvent({ calendarId: 'primary', event: event(30) }),
    ).rejects.toSatisfy(InvalidArgumentError.isInstance);
    await expect(
      calendar.doCreateEvent({
        calendarId: '42',
        event: { start: { date: '2030-01-07' }, end: { date: '2030-01-08' } },
      }),
    ).rejects.toSatisfy(UnsupportedFunctionalityError.isInstance);
  });

  it('moves a booking by rescheduling it under a new id, keeping its length', async () => {
    const { calendar, requests } = fakeCalcom([booking('a', 12)]);
    const { event } = await calendar.doUpdateEvent({
      calendarId: '42',
      eventId: 'a',
      patch: { start: { dateTime: '2030-01-07T14:00:00Z', timeZone: 'Asia/Kolkata' } },
    });
    expect(event.id).toBe('a-moved');
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      body: { start: '2030-01-07T14:00:00.000Z', allowConflicts: true },
    });

    // Other fields cannot change: the booking stays as it is.
    const before = requests.length;
    const renamed = await calendar.doUpdateEvent({
      calendarId: '42',
      eventId: 'a',
      patch: { title: 'New name' },
    });
    expect(renamed.event.id).toBe('a');
    expect(renamed.warnings).toEqual([expect.objectContaining({ feature: 'title' })]);
    expect(requests.slice(before).map((request) => request.method)).toEqual(['GET']);
  });
});
