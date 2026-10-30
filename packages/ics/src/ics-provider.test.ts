import {
  APICallError,
  InvalidArgumentError,
  InvalidResponseDataError,
  NotFoundError,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { ics } from './ics-provider';

const STANDUP = 'standup@example.com';

/**
 * A feed in the shapes real exports use: CRLF lines, a folded line, a series with an
 * EXDATE, a moved and a cancelled instance, and times in UTC, IANA, Windows, custom
 * VTIMEZONE and floating form. `edits` replace or drop whole events by UID.
 */
function feed({ title = 'Design review', extra = '', stamp = '20261030T000000Z' } = {}) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Feed//EN',
    'X-WR-CALNAME:Team',
    'X-WR-CALDESC:Shared team calendar',
    'X-WR-TIMEZONE:Asia/Kolkata',
    'BEGIN:VTIMEZONE',
    'TZID:Customized Time Zone',
    'BEGIN:STANDARD',
    'DTSTART:16010101T030000',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:16010101T020000',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${STANDUP}`,
    `DTSTAMP:${stamp}`,
    'DTSTART;TZID=America/New_York:20261102T090000',
    'DTEND;TZID=America/New_York:20261102T093000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
    'EXDATE;TZID=America/New_York:20261104T090000',
    'SUMMARY:Standup',
    'END:VEVENT',
    'BEGIN:VEVENT',
    `UID:${STANDUP}`,
    `DTSTAMP:${stamp}`,
    'RECURRENCE-ID;TZID=America/New_York:20261109T090000',
    'DTSTART;TZID=America/New_York:20261109T110000',
    'DTEND;TZID=America/New_York:20261109T113000',
    'SUMMARY:Standup (moved)',
    'END:VEVENT',
    'BEGIN:VEVENT',
    `UID:${STANDUP}`,
    `DTSTAMP:${stamp}`,
    'RECURRENCE-ID;TZID=America/New_York:20261111T090000',
    'DTSTART;TZID=America/New_York:20261111T090000',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:review@example.com',
    `DTSTAMP:${stamp}`,
    'DTSTART:20261105T103000Z',
    'DTEND:20261105T113000Z',
    `SUMMARY:${title}`,
    'DESCRIPTION:Notes and the call: https://meet.google.com/abc-defg-hij for every',
    ' one invited',
    'STATUS:TENTATIVE',
    'CLASS:PRIVATE',
    'TRANSP:TRANSPARENT',
    'ORGANIZER;CN=Ada:mailto:ada@example.com',
    'ATTENDEE;CN=Ada;PARTSTAT=ACCEPTED:mailto:ada@example.com',
    'ATTENDEE;PARTSTAT=DECLINED;ROLE=OPT-PARTICIPANT:mailto:bob@example.com',
    'ATTENDEE;CUTYPE=ROOM:urn:x-room:4',
    'CREATED:20261001T080000Z',
    'LAST-MODIFIED:20261002T080000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:trip@example.com',
    `DTSTAMP:${stamp}`,
    'DTSTART;VALUE=DATE:20261107',
    'DTEND;VALUE=DATE:20261109',
    'SUMMARY:Offsite',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:outlook@example.com',
    `DTSTAMP:${stamp}`,
    'DTSTART;TZID=India Standard Time:20261106T090000',
    'DTEND;TZID=India Standard Time:20261106T100000',
    'SUMMARY:Planning',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:custom@example.com',
    `DTSTAMP:${stamp}`,
    'DTSTART;TZID=Customized Time Zone:20261103T090000',
    'DURATION:PT1H',
    'SUMMARY:Vendor call',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:floating@example.com',
    `DTSTAMP:${stamp}`,
    'DTSTART:20261104T090000',
    'DTEND:20261104T100000',
    'SUMMARY:Gym',
    'END:VEVENT',
    extra,
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

type Request = { url: string; headers: Headers };

/** Serves `responses` in order, repeating the last one. */
function fakeFetch(...responses: (() => Response)[]) {
  const requests: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    const respond = responses[Math.min(requests.length, responses.length) - 1];
    if (!respond) throw new Error('No response configured.');
    return respond();
  };
  return { fetch, requests };
}

const failureOf = (promise: PromiseLike<unknown>) =>
  Promise.resolve(promise).then(
    () => undefined,
    (error: unknown) => error,
  );

const serve = (text: () => string) => fakeFetch(() => new Response(text()));
const URL_ = 'https://feeds.example.com/team.ics';
const window = { timeMin: '2026-11-01T00:00:00Z', timeMax: '2026-11-17T00:00:00Z' };

describe('ics provider', () => {
  it('reads the feed as one read-only primary calendar', async () => {
    const provider = ics({ url: URL_, fetch: serve(() => feed()).fetch });
    expect((await provider.doListCalendars({})).calendars).toEqual([
      {
        id: 'primary',
        name: 'Team',
        description: 'Shared team calendar',
        timeZone: 'Asia/Kolkata',
        isPrimary: true,
        accessRole: 'reader',
      },
    ]);
    await expect(
      provider.doCreateEvent({
        calendarId: 'primary',
        event: { start: { date: '2026-11-01' }, end: { date: '2026-11-02' } },
      }),
    ).rejects.toBeInstanceOf(UnsupportedFunctionalityError);
    await expect(
      provider.doGetEvent({ calendarId: 'other', eventId: STANDUP }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('expands series with their EXDATEs, moved and cancelled instances, in start order', async () => {
    const provider = ics({ url: URL_, fetch: serve(() => feed()).fetch });
    const { events } = await provider.doListEvents({
      calendarId: 'primary',
      ...window,
      expandRecurring: true,
    });
    expect(events.map((event) => [event.id, event.kind, event.start])).toEqual([
      [
        `${STANDUP}_20261102T140000Z`,
        'occurrence',
        { dateTime: '2026-11-02T09:00:00-05:00', timeZone: 'America/New_York' },
      ],
      [
        'custom@example.com',
        'single',
        // Custom zones are converted with the VTIMEZONE and shown in the calendar's zone.
        { dateTime: '2026-11-03T13:30:00+05:30', timeZone: 'Asia/Kolkata' },
      ],
      [
        'floating@example.com',
        'single',
        { dateTime: '2026-11-04T09:00:00+05:30', timeZone: 'Asia/Kolkata' },
      ],
      [
        'review@example.com',
        'single',
        { dateTime: '2026-11-05T16:00:00+05:30', timeZone: 'Asia/Kolkata' },
      ],
      [
        'outlook@example.com',
        'single',
        { dateTime: '2026-11-06T09:00:00+05:30', timeZone: 'Asia/Kolkata' },
      ],
      ['trip@example.com', 'single', { date: '2026-11-07' }],
      [
        `${STANDUP}_20261109T140000Z`,
        'exception',
        { dateTime: '2026-11-09T11:00:00-05:00', timeZone: 'America/New_York' },
      ],
      [
        `${STANDUP}_20261116T140000Z`,
        'occurrence',
        { dateTime: '2026-11-16T09:00:00-05:00', timeZone: 'America/New_York' },
      ],
    ]);
    const moved = events.find((event) => event.kind === 'exception');
    expect(moved).toMatchObject({
      seriesId: STANDUP,
      title: 'Standup (moved)',
      originalStart: { dateTime: '2026-11-09T09:00:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-09T11:30:00-05:00', timeZone: 'America/New_York' },
    });
    expect(events.find((event) => event.id === 'custom@example.com')?.end).toEqual({
      dateTime: '2026-11-03T14:30:00+05:30',
      timeZone: 'Asia/Kolkata',
    });
  });

  it('lists each series once when not expanding', async () => {
    const provider = ics({ url: URL_, fetch: serve(() => feed()).fetch });
    const { events } = await provider.doListEvents({
      calendarId: 'primary',
      ...window,
      expandRecurring: false,
    });
    const series = events.filter((event) => event.kind === 'series');
    expect(series).toEqual([
      expect.objectContaining({
        id: STANDUP,
        recurrence: [
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
          'EXDATE;TZID=America/New_York:20261104T090000',
        ],
      }),
    ]);
    expect(events).toHaveLength(6);
  });

  it('maps people, status, visibility and meeting links', async () => {
    const provider = ics({ url: URL_, fetch: serve(() => feed()).fetch });
    const { event } = await provider.doGetEvent({
      calendarId: 'primary',
      eventId: 'review@example.com',
    });
    expect(event).toMatchObject({
      title: 'Design review',
      description: 'Notes and the call: https://meet.google.com/abc-defg-hij for everyone invited',
      status: 'tentative',
      showAs: 'free',
      visibility: 'private',
      organizer: { email: 'ada@example.com', name: 'Ada' },
      attendees: [
        { email: 'ada@example.com', name: 'Ada', responseStatus: 'accepted', organizer: true },
        { email: 'bob@example.com', responseStatus: 'declined', optional: true },
      ],
      conference: { provider: 'google-meet', joinUrl: 'https://meet.google.com/abc-defg-hij' },
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-02T08:00:00.000Z',
    });
  });

  it('gets occurrences and exceptions by id, and not instances the series skips', async () => {
    const provider = ics({ url: URL_, fetch: serve(() => feed()).fetch });
    const get = (eventId: string) => provider.doGetEvent({ calendarId: 'primary', eventId });

    expect((await get(`${STANDUP}_20261116T140000Z`)).event).toMatchObject({
      kind: 'occurrence',
      seriesId: STANDUP,
      start: { dateTime: '2026-11-16T09:00:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-16T09:30:00-05:00', timeZone: 'America/New_York' },
    });
    expect((await get(`${STANDUP}_20261109T140000Z`)).event.title).toBe('Standup (moved)');
    expect((await get(STANDUP)).event.kind).toBe('series');
    for (const skipped of ['20261104T140000Z', '20261111T140000Z', '20261102T150000Z', 'x']) {
      await expect(get(`${STANDUP}_${skipped}`)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it('pages after the last event returned, even when the feed changes between pages', async () => {
    let extra = '';
    const provider = ics({ url: URL_, fetch: serve(() => feed({ extra })).fetch });
    const list = (pageToken?: string) =>
      provider.doListEvents({
        calendarId: 'primary',
        ...window,
        expandRecurring: true,
        pageSize: 3,
        pageToken,
      });

    const first = await list();
    expect(first.events.map((event) => event.id)).toEqual([
      `${STANDUP}_20261102T140000Z`,
      'custom@example.com',
      'floating@example.com',
    ]);
    // An event added before the cursor is not returned on later pages, and nothing repeats.
    extra = 'BEGIN:VEVENT\r\nUID:early@example.com\r\nDTSTART:20261101T120000Z\r\nEND:VEVENT';
    const second = await list(first.nextPageToken);
    expect(second.events.map((event) => event.id)).toEqual([
      'review@example.com',
      'outlook@example.com',
      'trip@example.com',
    ]);
    const third = await list(second.nextPageToken);
    expect(third.events).toHaveLength(2);
    expect(third.nextPageToken).toBeUndefined();
    await expect(list('not a token')).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('syncs by comparing each event with the last sync', async () => {
    let text = feed();
    const provider = ics({ url: URL_, fetch: serve(() => text).fetch });
    const sync = (cursor?: string) => provider.doSyncEvents({ calendarId: 'primary', cursor });

    const initial = await sync();
    // Single events, the series and its moved instance, never computed occurrences, and the
    // instance the series cancels.
    expect(
      initial.changes.map((change) =>
        change.type === 'upsert' ? change.event.id : `deleted ${change.eventId}`,
      ),
    ).toEqual([
      STANDUP,
      `${STANDUP}_20261109T140000Z`,
      `deleted ${STANDUP}_20261111T140000Z`,
      'review@example.com',
      'trip@example.com',
      'outlook@example.com',
      'custom@example.com',
      'floating@example.com',
    ]);

    // Feeds restamp every event on each download: that alone is not a change.
    text = feed({ stamp: '20261031T000000Z' });
    const unchanged = await sync(initial.nextCursor);
    expect(unchanged.changes).toEqual([]);

    text = feed({ title: 'Design review v2' }).replace(
      /BEGIN:VEVENT\r\nUID:trip[\s\S]*?END:VEVENT\r\n/,
      '',
    );
    const changed = await sync(unchanged.nextCursor);
    expect(changed.changes).toEqual([
      { type: 'upsert', event: expect.objectContaining({ title: 'Design review v2' }) },
      { type: 'delete', eventId: 'trip@example.com' },
    ]);
    await expect(sync('garbage')).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('deletes an instance once when the feed cancels it, also without its times', async () => {
    const cancel = [
      'BEGIN:VEVENT',
      `UID:${STANDUP}`,
      'RECURRENCE-ID;TZID=America/New_York:20261102T090000',
      'STATUS:CANCELLED',
      'END:VEVENT',
    ].join('\r\n');
    let text = feed();
    const provider = ics({ url: URL_, fetch: serve(() => text).fetch });
    const initial = await provider.doSyncEvents({ calendarId: 'primary' });

    text = feed({ extra: cancel });
    const cancelled = await provider.doSyncEvents({
      calendarId: 'primary',
      cursor: initial.nextCursor,
    });
    expect(cancelled.changes).toEqual([
      { type: 'upsert', event: expect.objectContaining({ id: STANDUP }) },
      { type: 'delete', eventId: `${STANDUP}_20261102T140000Z` },
    ]);
    const again = await provider.doSyncEvents({
      calendarId: 'primary',
      cursor: cancelled.nextCursor,
    });
    expect(again.changes).toEqual([]);

    const { events } = await provider.doListEvents({
      calendarId: 'primary',
      ...window,
      expandRecurring: true,
    });
    expect(events.map((event) => event.id)).not.toContain(`${STANDUP}_20261102T140000Z`);

    // Restoring the instance changes the series again.
    text = feed();
    const restored = await provider.doSyncEvents({
      calendarId: 'primary',
      cursor: again.nextCursor,
    });
    expect(restored.changes).toEqual([
      { type: 'upsert', event: expect.objectContaining({ id: STANDUP }) },
    ]);

    // A first sync reports a cancellation the feed already has.
    text = feed({ extra: cancel });
    const first = await provider.doSyncEvents({ calendarId: 'primary' });
    expect(first.changes).toContainEqual({
      type: 'delete',
      eventId: `${STANDUP}_20261102T140000Z`,
    });
  });

  it('skips the download when the feed has not changed', async () => {
    const { fetch, requests } = fakeFetch(
      () => new Response(feed(), { headers: { etag: '"v1"' } }),
      () => new Response(null, { status: 304 }),
    );
    const provider = ics({ url: URL_, fetch });
    const initial = await provider.doSyncEvents({ calendarId: 'primary' });
    const next = await provider.doSyncEvents({
      calendarId: 'primary',
      cursor: initial.nextCursor,
    });
    expect(requests[1]?.headers.get('if-none-match')).toBe('"v1"');
    expect(next).toEqual({ changes: [], nextCursor: initial.nextCursor, warnings: [] });
  });

  it('reads webcal addresses over HTTPS and sends headers only to the feed origin', async () => {
    const { fetch, requests } = fakeFetch(
      () => new Response(null, { status: 302, headers: { location: '/v2/team.ics' } }),
      () =>
        new Response(null, { status: 301, headers: { location: 'https://cdn.example.net/t.ics' } }),
      () => new Response(feed()),
    );
    const provider = ics({
      url: 'webcal://feeds.example.com/team.ics',
      headers: { authorization: 'Basic c2VjcmV0' },
      fetch,
    });
    await provider.doListCalendars({});
    expect(requests.map((request) => [request.url, request.headers.get('authorization')])).toEqual([
      ['https://feeds.example.com/team.ics', 'Basic c2VjcmV0'],
      ['https://feeds.example.com/v2/team.ics', 'Basic c2VjcmV0'],
      ['https://cdn.example.net/t.ics', null],
    ]);
    expect(() => ics({ url: 'file:///etc/passwd' })).toThrow(InvalidArgumentError);
  });

  it('keeps the secret part of feed addresses out of errors', async () => {
    const url = 'https://feeds.example.com/private-s3cr3t/basic.ics?token=s3cr3t';
    const notFound = ics({
      url,
      fetch: fakeFetch(() => new Response(`No such file: ${url}`, { status: 404 })).fetch,
    });
    const missing = await failureOf(notFound.doListCalendars({}));
    expect(missing).toBeInstanceOf(NotFoundError);

    const offline = ics({
      url,
      fetch: async () => {
        throw new TypeError(`fetch failed for ${url}`);
      },
    });
    const failed = await failureOf(offline.doListCalendars({}));
    expect(APICallError.isInstance(failed) && failed.isRetryable).toBe(true);

    // An error page served as a success, and a redirect to an address that does not parse.
    const echoed = await failureOf(
      ics({
        url,
        fetch: fakeFetch(() => new Response(`<html>${url}</html>`)).fetch,
      }).doListCalendars({}),
    );
    expect(echoed).toBeInstanceOf(InvalidResponseDataError);
    const redirected = await failureOf(
      ics({
        url,
        fetch: fakeFetch(
          () => new Response(null, { status: 302, headers: { location: 'http://[s3cr3t' } }),
        ).fetch,
      }).doListCalendars({}),
    );
    expect(APICallError.isInstance(redirected)).toBe(true);

    for (const error of [missing, failed, echoed, redirected]) {
      const seen = new Set<unknown>();
      let current: unknown = error;
      while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        expect(JSON.stringify({ ...current, message: current.message })).not.toContain('s3cr3t');
        current = current.cause;
      }
    }
  });

  it('rejects responses that are not iCalendar', async () => {
    const provider = ics({ url: URL_, fetch: serve(() => '<html>Sign in</html>').fetch });
    await expect(provider.doListCalendars({})).rejects.toBeInstanceOf(InvalidResponseDataError);
  });

  // One series runs into the time limit of a second.
  it('bounds the work of expanding a series', async () => {
    const extra = [
      'BEGIN:VEVENT',
      'UID:ticker@example.com',
      'DTSTART:20200101T000000Z',
      'RRULE:FREQ=HOURLY',
      'END:VEVENT',
      // Each instance of this rule is a year of seconds after the last.
      'BEGIN:VEVENT',
      'UID:seconds@example.com',
      'DTSTART:20251231T235959Z',
      'RRULE:FREQ=SECONDLY;BYMONTH=12',
      'END:VEVENT',
      // No date matches: ical.js would search for one forever, but stops at the window.
      'BEGIN:VEVENT',
      'UID:never@example.com',
      'DTSTART:20260101T100000Z',
      'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:rarely-never@example.com',
      'DTSTART:20260101T100000Z',
      'RRULE:FREQ=DAILY;INTERVAL=1000;BYMONTH=2;BYMONTHDAY=30',
      'END:VEVENT',
      // Every fourth February from 2026 has four Mondays: ical.js would search while starting.
      'BEGIN:VEVENT',
      'UID:fifth@example.com',
      'DTSTART:20260202T100000Z',
      'RRULE:FREQ=MONTHLY;INTERVAL=48;BYDAY=5MO',
      'END:VEVENT',
      // Searched for hour by hour since the year 4, more than a second of work.
      'BEGIN:VEVENT',
      'UID:ancient@example.com',
      'DTSTART:00040229T000000Z',
      'RRULE:FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=29',
      'END:VEVENT',
      // RFC 5545 does not allow BYMONTHDAY in weekly rules, and ical.js rejects them.
      'BEGIN:VEVENT',
      'UID:weekly@example.com',
      'DTSTART:20260101T100000Z',
      'RRULE:FREQ=WEEKLY;BYMONTHDAY=1',
      'END:VEVENT',
      // Years of candidate hours, but each instance is found quickly.
      'BEGIN:VEVENT',
      'UID:shifts@example.com',
      'DTSTART:20180101T100000Z',
      'DURATION:PT1H',
      'RRULE:FREQ=HOURLY;BYDAY=MO,WE,FR',
      'END:VEVENT',
      // ical.js reads this INTERVAL as Infinity, and would move a date by it forever.
      'BEGIN:VEVENT',
      'UID:huge@example.com',
      'DTSTART:20260101T100000Z',
      `RRULE:FREQ=MONTHLY;INTERVAL=${'9'.repeat(309)}`,
      'END:VEVENT',
      // Finite, but ical.js would move the date by it one month at a time.
      'BEGIN:VEVENT',
      'UID:rare@example.com',
      'DTSTART:20260101T100000Z',
      'RRULE:FREQ=DAILY;INTERVAL=100000000',
      'END:VEVENT',
    ].join('\r\n');
    const provider = ics({ url: URL_, fetch: serve(() => feed({ extra })).fetch });
    const { events, warnings } = await provider.doListEvents({
      calendarId: 'primary',
      ...window,
      expandRecurring: true,
    });
    const of = (uid: string) => events.filter((event) => event.seriesId === uid);
    // Every hour of the seven Mondays, Wednesdays and Fridays from November 2 to 16.
    expect(of('shifts@example.com')).toHaveLength(168);
    expect(of('never@example.com')).toEqual([]);
    expect(warnings).toEqual([
      { type: 'other', message: expect.stringContaining('"ticker@example.com"') },
      {
        type: 'unsupported',
        feature: 'recurrence',
        details: expect.stringContaining('"seconds@example.com"'),
      },
      { type: 'other', message: expect.stringContaining('"ancient@example.com" after 1000 ms') },
      {
        type: 'unsupported',
        feature: 'recurrence',
        details: expect.stringContaining('"weekly@example.com"'),
      },
      {
        type: 'unsupported',
        feature: 'recurrence',
        details: expect.stringContaining('"huge@example.com"'),
      },
      {
        type: 'unsupported',
        feature: 'recurrence',
        details: expect.stringContaining('"rare@example.com"'),
      },
    ]);
    // A sparse rule that is not cut short: 2100 is not a leap year, so it skips from 2096 to 2104.
    const leap = [
      'BEGIN:VEVENT',
      'UID:leap@example.com',
      'DTSTART:20960229T100000Z',
      'DURATION:PT1H',
      'RRULE:FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=29',
      'END:VEVENT',
    ].join('\r\n');
    const leapFeed = ics({ url: URL_, fetch: serve(() => feed({ extra: leap })).fetch });
    const leapDay = await leapFeed.doListEvents({
      calendarId: 'primary',
      timeMin: '2104-02-29T00:00:00Z',
      timeMax: '2104-03-01T00:00:00Z',
      expandRecurring: true,
    });
    expect(leapDay.events.filter((event) => event.seriesId === 'leap@example.com')).toHaveLength(
      24,
    );
    // Searching for a fifth Monday passes the window, but the second Tuesday is inside it.
    // ical.js starts these rules on a time BYSETPOS may rule out: February 8 is not the second
    // of its month, nor February 7 the last.
    const monthly = [
      ['mixed', 'FREQ=MONTHLY;BYDAY=5MO,2TU'],
      ['second', 'FREQ=MONTHLY;BYDAY=5MO,2TU;BYSETPOS=2'],
      ['last', 'FREQ=MONTHLY;BYDAY=-1FR,1MO;BYSETPOS=-1;COUNT=2'],
    ].flatMap(([uid, rule]) => [
      'BEGIN:VEVENT',
      `UID:${uid}@example.com`,
      'DTSTART:20280201T100000Z',
      'DURATION:PT1H',
      `RRULE:${rule}`,
      'END:VEVENT',
    ]);
    const monthlyFeed = ics({
      url: URL_,
      fetch: serve(() => feed({ extra: monthly.join('\r\n') })).fetch,
    });
    const spring = await monthlyFeed.doListEvents({
      calendarId: 'primary',
      timeMin: '2028-02-02T00:00:00Z',
      timeMax: '2028-05-01T00:00:00Z',
      expandRecurring: true,
    });
    const days = (uid: string) =>
      spring.events
        .filter((event) => event.seriesId === uid)
        .map((event) => event.start.dateTime?.slice(0, 10));
    expect(days('mixed@example.com')).toEqual(['2028-02-08', '2028-03-14', '2028-04-11']);
    expect(days('second@example.com')).toEqual([]);
    expect(days('last@example.com')).toEqual(['2028-02-25', '2028-03-31']);
    expect(spring.warnings).toEqual([]);
  }, 15_000);

  it('reads each recurrence date in its own zone, and always starts at DTSTART', async () => {
    const extra = [
      'BEGIN:VEVENT',
      'UID:until@example.com',
      'DTSTART;TZID=America/New_York:20261102T090000',
      'DTEND;TZID=America/New_York:20261102T100000',
      // Until 08:30 New York on the 4th, so not the 4th; the 3rd is excluded in UTC.
      'RRULE:FREQ=DAILY;UNTIL=20261104T133000Z',
      'EXDATE:20261103T140000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:dates@example.com',
      'DTSTART;VALUE=DATE:20261102',
      'RDATE;VALUE=DATE:20261103',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:extra@example.com',
      'DTSTART;TZID=America/New_York:20261102T090000',
      'DTEND;TZID=America/New_York:20261102T100000',
      'RDATE:20261103T140000Z',
      'RDATE;VALUE=PERIOD:20261105T150000Z/20261105T170000Z',
      'END:VEVENT',
      // Clocks go back at 02:00 on November 1, so 01:30 comes twice: first at 05:30 UTC.
      'BEGIN:VEVENT',
      'UID:fold@example.com',
      'DTSTART;TZID=America/New_York:20261031T013000',
      'DURATION:PT30M',
      'RRULE:FREQ=DAILY;UNTIL=20261101T060000Z',
      'END:VEVENT',
      // A period sets its instance's length, also when DTSTART or another RDATE is there too.
      'BEGIN:VEVENT',
      'UID:longer@example.com',
      'DTSTART:20261102T120000Z',
      'DURATION:PT1H',
      'RDATE:20261102T120000Z',
      'RDATE;VALUE=PERIOD:20261102T120000Z/20261102T150000Z',
      'END:VEVENT',
    ].join('\r\n');
    const provider = ics({ url: URL_, fetch: serve(() => feed({ extra })).fetch });
    const { events } = await provider.doListEvents({
      calendarId: 'primary',
      timeMin: '2026-10-30T00:00:00Z',
      timeMax: window.timeMax,
      expandRecurring: true,
    });
    const of = (uid: string) =>
      events
        .filter((event) => event.seriesId === uid)
        .map((event) => [
          event.id,
          event.start.dateTime ?? event.start.date,
          event.end.dateTime ?? event.end.date,
        ]);
    expect(of('until@example.com')).toEqual([
      [
        'until@example.com_20261102T140000Z',
        '2026-11-02T09:00:00-05:00',
        '2026-11-02T10:00:00-05:00',
      ],
    ]);
    expect(of('dates@example.com')).toEqual([
      ['dates@example.com_20261102', '2026-11-02', '2026-11-03'],
      ['dates@example.com_20261103', '2026-11-03', '2026-11-04'],
    ]);
    expect(of('extra@example.com')).toEqual([
      [
        'extra@example.com_20261102T140000Z',
        '2026-11-02T09:00:00-05:00',
        '2026-11-02T10:00:00-05:00',
      ],
      [
        'extra@example.com_20261103T140000Z',
        '2026-11-03T09:00:00-05:00',
        '2026-11-03T10:00:00-05:00',
      ],
      [
        'extra@example.com_20261105T150000Z',
        '2026-11-05T10:00:00-05:00',
        '2026-11-05T12:00:00-05:00',
      ],
    ]);
    expect(of('fold@example.com').map(([id]) => id)).toEqual([
      'fold@example.com_20261031T053000Z',
      'fold@example.com_20261101T053000Z',
    ]);
    expect(of('longer@example.com')).toEqual([
      [
        'longer@example.com_20261102T120000Z',
        '2026-11-02T17:30:00+05:30',
        '2026-11-02T20:30:00+05:30',
      ],
    ]);
  });

  it('counts the days of a length in the zone of the event, and its hours as elapsed time', async () => {
    const extra = [
      'BEGIN:VEVENT',
      'UID:days@example.com',
      'DTSTART;TZID=America/New_York:20260307T120000',
      'DURATION:P1D',
      'RRULE:FREQ=DAILY;COUNT=2',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:hours@example.com',
      'DTSTART;TZID=America/New_York:20260307T120000',
      'DURATION:PT24H',
      'END:VEVENT',
      // Days in UTC are 24 hours, also when shown in New York.
      'BEGIN:VEVENT',
      'UID:utc@example.com',
      'DTSTART:20260307T170000Z',
      'DURATION:P1D',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:period@example.com',
      'DTSTART;TZID=America/New_York:20260306T120000',
      'DTEND;TZID=America/New_York:20260306T130000',
      'RDATE;TZID=America/New_York;VALUE=PERIOD:20260307T120000/PT24H',
      'END:VEVENT',
    ].join('\r\n');
    const text = feed({ extra }).replace(
      'X-WR-TIMEZONE:Asia/Kolkata',
      'X-WR-TIMEZONE:America/New_York',
    );
    const provider = ics({ url: URL_, fetch: serve(() => text).fetch });
    const { events } = await provider.doListEvents({
      calendarId: 'primary',
      timeMin: '2026-03-07T00:00:00Z',
      timeMax: '2026-03-10T00:00:00Z',
      expandRecurring: true,
    });
    // Clocks move forward on March 8.
    expect(events.map((event) => [event.id, event.end.dateTime])).toEqual([
      ['days@example.com_20260307T170000Z', '2026-03-08T12:00:00-04:00'],
      ['hours@example.com', '2026-03-08T13:00:00-04:00'],
      ['period@example.com_20260307T170000Z', '2026-03-08T13:00:00-04:00'],
      ['utc@example.com', '2026-03-08T13:00:00-04:00'],
      ['days@example.com_20260308T160000Z', '2026-03-09T12:00:00-04:00'],
    ]);
  });
});
