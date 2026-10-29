import {
  ConflictError,
  type EventV1,
  NotFoundError,
  SyncCursorExpiredError,
} from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { mockCalendar } from './mock-calendar';

const kolkata = (dateTime: string) => ({ dateTime, timeZone: 'Asia/Kolkata' });
const weekly = (recurrence = ['RRULE:FREQ=WEEKLY;COUNT=4']) =>
  mockCalendar({
    now: () => new Date('2026-10-01T00:00:00Z'),
    events: [
      {
        title: 'Weekly',
        start: kolkata('2026-11-02T10:00:00+05:30'),
        end: kolkata('2026-11-02T10:30:00+05:30'),
        recurrence,
      },
    ],
  });
const window = {
  calendarId: 'primary',
  timeMin: '2026-11-01T00:00:00Z',
  timeMax: '2026-12-31T00:00:00Z',
  expandRecurring: true,
};
const ids = (events: EventV1[]) => events.map((event) => event.id);

describe('mockCalendar', () => {
  it('resolves primary and rejects unknown calendars', async () => {
    const calendar = mockCalendar({ calendars: [{ id: 'work' }, { id: 'home', isPrimary: true }] });
    const { calendars } = await calendar.doListCalendars({});
    expect(calendars.map((c) => [c.id, c.isPrimary])).toEqual([
      ['work', false],
      ['home', true],
    ]);
    await expect(calendar.doListEvents({ ...window, calendarId: 'nope' })).rejects.toSatisfy(
      NotFoundError.isInstance,
    );
  });

  it('round-trips events with deterministic ids and versioned etags', async () => {
    const calendar = mockCalendar();
    const { event } = await calendar.doCreateEvent({
      calendarId: 'primary',
      event: {
        title: 'Lunch',
        start: { date: '2026-11-03' },
        end: { date: '2026-11-04' },
        attendees: [{ email: 'a@example.com' }],
        createConference: true,
      },
    });
    expect(event).toMatchObject({
      id: 'evt_1',
      calendarId: 'cal_1',
      kind: 'single',
      etag: '"1"',
      showAs: 'busy',
      attendees: [{ email: 'a@example.com', responseStatus: 'needsAction' }],
      conference: { joinUrl: 'https://meet.example.com/evt_1' },
    });

    const { event: updated } = await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'evt_1',
      patch: { title: 'Long lunch', attendees: null },
      ifMatch: '"1"',
    });
    expect(updated).toMatchObject({ title: 'Long lunch', etag: '"2"' });
    expect(updated.attendees).toBeUndefined();

    await expect(
      calendar.doDeleteEvent({ calendarId: 'primary', eventId: 'evt_1', ifMatch: '"1"' }),
    ).rejects.toSatisfy(ConflictError.isInstance);
  });

  it('expands series and finds occurrences by id', async () => {
    const calendar = weekly();
    const { events } = await calendar.doListEvents(window);
    expect(ids(events)).toEqual([
      'evt_1_20261102T043000Z',
      'evt_1_20261109T043000Z',
      'evt_1_20261116T043000Z',
      'evt_1_20261123T043000Z',
    ]);
    expect(events[1]).toMatchObject({ kind: 'occurrence', seriesId: 'evt_1', title: 'Weekly' });

    const { event } = await calendar.doGetEvent({
      calendarId: 'primary',
      eventId: 'evt_1_20261109T043000Z',
    });
    expect(event.start).toEqual(kolkata('2026-11-09T10:00:00+05:30'));
    await expect(
      calendar.doGetEvent({ calendarId: 'primary', eventId: 'evt_1_20261110T043000Z' }),
    ).rejects.toSatisfy(NotFoundError.isInstance);

    const masters = await calendar.doListEvents({ ...window, expandRecurring: false });
    expect(ids(masters.events)).toEqual(['evt_1']);
  });

  it('turns a modified occurrence into an exception and deletes single occurrences', async () => {
    const calendar = weekly();
    const { event } = await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'evt_1_20261109T043000Z',
      patch: {
        title: 'Moved',
        start: kolkata('2026-11-10T11:00:00+05:30'),
        end: kolkata('2026-11-10T11:30:00+05:30'),
      },
    });
    expect(event).toMatchObject({
      id: 'evt_1_20261109T043000Z',
      kind: 'exception',
      title: 'Moved',
      originalStart: kolkata('2026-11-09T10:00:00+05:30'),
    });

    await calendar.doDeleteEvent({ calendarId: 'primary', eventId: 'evt_1_20261116T043000Z' });

    const { events } = await calendar.doListEvents(window);
    expect(events.map((e) => [e.id, e.kind])).toEqual([
      ['evt_1_20261102T043000Z', 'occurrence'],
      ['evt_1_20261109T043000Z', 'exception'],
      ['evt_1_20261123T043000Z', 'occurrence'],
    ]);
  });

  it('shifts the whole series when an instance moves with scope all', async () => {
    const calendar = weekly();
    const { event } = await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'evt_1_20261109T043000Z',
      scope: 'all',
      patch: {
        start: kolkata('2026-11-09T11:00:00+05:30'),
        end: kolkata('2026-11-09T11:30:00+05:30'),
      },
    });
    expect(event).toMatchObject({ id: 'evt_1', kind: 'series' });
    expect(event.start).toEqual(kolkata('2026-11-02T11:00:00+05:30'));
  });

  it('splits a series for thisAndFollowing and keeps the total COUNT', async () => {
    const calendar = weekly();
    const { event } = await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'evt_1_20261116T043000Z',
      scope: 'thisAndFollowing',
      patch: { title: 'Renamed' },
    });
    expect(event).toMatchObject({ id: 'evt_2', kind: 'series', title: 'Renamed' });
    expect(event.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=2']);

    const { events } = await calendar.doListEvents(window);
    expect(events.map((e) => [e.seriesId, e.title])).toEqual([
      ['evt_1', 'Weekly'],
      ['evt_1', 'Weekly'],
      ['evt_2', 'Renamed'],
      ['evt_2', 'Renamed'],
    ]);
  });

  it('deletes this and following instances, or the whole series from its first instance', async () => {
    const calendar = weekly(['RRULE:FREQ=WEEKLY']);
    await calendar.doDeleteEvent({
      calendarId: 'primary',
      eventId: 'evt_1_20261116T043000Z',
      scope: 'thisAndFollowing',
    });
    expect(ids((await calendar.doListEvents(window)).events)).toEqual([
      'evt_1_20261102T043000Z',
      'evt_1_20261109T043000Z',
    ]);

    await calendar.doDeleteEvent({
      calendarId: 'primary',
      eventId: 'evt_1_20261102T043000Z',
      scope: 'thisAndFollowing',
    });
    expect(calendar.events).toEqual([]);
  });

  it('paginates list results', async () => {
    const calendar = weekly();
    const first = await calendar.doListEvents({ ...window, pageSize: 3 });
    const second = await calendar.doListEvents({
      ...window,
      pageSize: 3,
      pageToken: first.nextPageToken,
    });
    expect(first.events).toHaveLength(3);
    expect(second.events).toHaveLength(1);
    expect(second.nextPageToken).toBeUndefined();
  });

  it('syncs incrementally with a cursor', async () => {
    const calendar = mockCalendar({ defaultPageSize: 1 });
    const create = (title: string) =>
      calendar.doCreateEvent({
        calendarId: 'primary',
        event: { title, start: { date: '2026-11-03' }, end: { date: '2026-11-04' } },
      });
    await create('A');
    await create('B');

    const page1 = await calendar.doSyncEvents({ calendarId: 'primary' });
    expect(page1.nextCursor).toBeUndefined();
    const page2 = await calendar.doSyncEvents({
      calendarId: 'primary',
      pageToken: page1.nextPageToken,
    });
    expect(
      [...page1.changes, ...page2.changes].map((c) => c.type === 'upsert' && c.event.title),
    ).toEqual(['A', 'B']);
    const cursor = page2.nextCursor;

    await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'evt_1',
      patch: { title: 'A2' },
    });
    await calendar.doDeleteEvent({ calendarId: 'primary', eventId: 'evt_2' });
    const next = await calendar.doSyncEvents({ calendarId: 'primary', cursor });
    const rest = await calendar.doSyncEvents({
      calendarId: 'primary',
      pageToken: next.nextPageToken,
    });
    expect([...next.changes, ...rest.changes]).toEqual([
      { type: 'upsert', event: expect.objectContaining({ id: 'evt_1', title: 'A2' }) },
      { type: 'delete', eventId: 'evt_2' },
    ]);

    await expect(
      calendar.doSyncEvents({ calendarId: 'primary', cursor: 'cal_1:999' }),
    ).rejects.toSatisfy(SyncCursorExpiredError.isInstance);
  });
});
