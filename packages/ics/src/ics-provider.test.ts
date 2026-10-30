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
    // Single events, the series and its moved instance: never computed occurrences.
    expect(initial.changes.map((change) => change.type === 'upsert' && change.event.id)).toEqual([
      STANDUP,
      `${STANDUP}_20261109T140000Z`,
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

    for (const error of [missing, failed]) {
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

  it('stops expanding a series with too many instances', async () => {
    const extra = [
      'BEGIN:VEVENT',
      'UID:ticker@example.com',
      'DTSTART:20200101T000000Z',
      'RRULE:FREQ=MINUTELY',
      'END:VEVENT',
    ].join('\r\n');
    const provider = ics({ url: URL_, fetch: serve(() => feed({ extra })).fetch });
    const { warnings } = await provider.doListEvents({
      calendarId: 'primary',
      ...window,
      expandRecurring: true,
    });
    expect(warnings).toEqual([
      { type: 'other', message: expect.stringContaining('"ticker@example.com"') },
    ]);
  });
});
