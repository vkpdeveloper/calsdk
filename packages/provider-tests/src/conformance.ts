import {
  AuthenticationError,
  type CalendarProviderV1,
  type CapabilityV1,
  ConflictError,
  type EventInputV1,
  type EventTimeV1,
  type EventV1,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  type SyncChangeV1,
} from '@calsdk/provider';
import {
  addDaysToDate,
  eventTimeToInstant,
  type FetchFunction,
  formatZonedDateTime,
  isAllDay,
  isValidTimeZone,
  localToInstant,
} from '@calsdk/provider-utils';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createRecordingFetch, type RecordingMode } from './recording-fetch';

export type ProviderConformanceOptions = {
  /** Suite name, e.g. `'google'`. */
  name: string;
  /**
   * Creates the provider under test. Pass `fetch` through to the provider, so the suite
   * can record and replay requests and stub error responses.
   */
  createProvider: (settings: { fetch: FetchFunction }) => CalendarProviderV1;
  /**
   * Calendar the tests write to. Defaults to `'primary'`. Tests delete what they create,
   * but use a dedicated calendar when running against a real account.
   */
  calendarId?: string;
  /** Record and replay HTTP traffic. Omit to call the provider's API live. */
  recording?: { path: string; mode?: RecordingMode };
  /**
   * Run the tests that stub HTTP responses (error mapping, headers, abort signals).
   * Defaults to `true`. Set `false` for providers that do not call `fetch`.
   */
  http?: boolean;
  /**
   * First day test events are placed on, `'YYYY-MM-DD'`. Defaults to `'2030-01-07'`.
   * It is fixed, not relative to today, so recordings replay.
   */
  firstDay?: string;
};

const ZONE = 'America/New_York';
const OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Registers Vitest tests that check a provider against the calsdk contract.
 *
 * Tests run only for declared capabilities: a provider with `sync: false` is not
 * asked to sync. Capabilities that are `'unknown'` or conditional are skipped too.
 *
 * @example
 * describeProviderConformance({
 *   name: 'google',
 *   createProvider: ({ fetch }) => google({ accessToken: process.env.GOOGLE_TOKEN ?? 'replay', fetch }),
 *   recording: { path: 'test/fixtures/conformance.json', mode: process.env.CALSDK_RECORD ? 'record' : 'replay' },
 * });
 */
export function describeProviderConformance(options: ProviderConformanceOptions): void {
  const calendarId = options.calendarId ?? 'primary';
  const firstDay = options.firstDay ?? '2030-01-07';
  const recording = options.recording && createRecordingFetch(options.recording);
  const provider = options.createProvider({ fetch: recording?.fetch ?? globalThis.fetch });
  const { capabilities } = provider;
  // Without kept details (booking tools), titles are not checked and updates move events.
  const details = isSupported(capabilities.events.details);
  // Live tests make several API calls in a row.
  const timeout = 30_000;

  /** A timed event time `days` after `firstDay`, at `hour` local time in `timeZone`. */
  const at = (days: number, hour: number, timeZone = ZONE) => {
    const [year, month, day] = addDaysToDate(firstDay, days).split('-').map(Number);
    const instant = localToInstant(
      { year: year ?? 0, month: month ?? 0, day: day ?? 0, hour, minute: 0, second: 0 },
      timeZone,
    );
    return { dateTime: formatZonedDateTime(instant, timeZone), timeZone };
  };
  const dayRange = (from: number, to = from + 1) => ({
    timeMin: new Date(eventTimeToInstant(at(from, 0))).toISOString(),
    timeMax: new Date(eventTimeToInstant(at(to, 0))).toISOString(),
  });

  // Every created event is deleted after its test, also when the test fails.
  const created: string[] = [];
  const create = async (event: EventInputV1) => {
    const result = await provider.doCreateEvent({ calendarId, event });
    created.push(result.event.id);
    expectValidEvent(result.event);
    return result.event;
  };

  const list = async (range: { timeMin: string; timeMax: string }, expandRecurring = true) => {
    const events: EventV1[] = [];
    let pageToken: string | undefined;
    do {
      const page = await provider.doListEvents({
        calendarId,
        ...range,
        expandRecurring,
        pageToken,
      });
      events.push(...page.events);
      pageToken = page.nextPageToken;
    } while (pageToken);
    events.forEach(expectValidEvent);
    return events;
  };

  describe(`${options.name} provider conformance`, () => {
    afterEach(async () => {
      const failed: { eventId: string; error: unknown }[] = [];
      for (const eventId of created.splice(0)) {
        try {
          await provider.doDeleteEvent({ calendarId, eventId, scope: 'all' });
        } catch (error) {
          if (!NotFoundError.isInstance(error)) failed.push({ eventId, error });
        }
      }
      if (failed.length > 0) {
        throw new AggregateError(
          failed.map(({ error }) => error),
          `Could not delete test events ${failed.map(({ eventId }) => eventId).join(', ')}. Remove them from the test calendar by hand.`,
        );
      }
    });
    if (recording) afterAll(() => recording.save());

    it('declares the v1 contract', () => {
      expect(provider.specificationVersion).toBe('v1');
      expect(provider.provider).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it(
      'lists calendars with exactly one primary',
      async () => {
        const { calendars } = await provider.doListCalendars({});
        expect(calendars.filter((calendar) => calendar.isPrimary)).toHaveLength(1);
        for (const calendar of calendars) {
          expect(calendar.id).toEqual(expect.any(String));
          expect(['owner', 'writer', 'reader', 'freeBusyReader']).toContain(calendar.accessRole);
          if (calendar.timeZone !== undefined)
            expect(isValidTimeZone(calendar.timeZone)).toBe(true);
        }
      },
      timeout,
    );

    it(
      'creates, reads, updates and deletes a timed event',
      async () => {
        const input = { title: 'calsdk conformance', start: at(0, 9), end: at(0, 10) };
        const event = await create(input);
        expect(event).toMatchObject({ kind: 'single', showAs: 'busy' });
        if (details) expect(event.title).toBe(input.title);
        expectSameTime(event.start, input.start);
        expectSameTime(event.end, input.end);

        const fetched = await provider.doGetEvent({ calendarId, eventId: event.id });
        expectValidEvent(fetched.event);
        expect(fetched.event.id).toBe(event.id);
        if (details) expect(fetched.event.title).toBe(input.title);

        const listed = await list(dayRange(0));
        expect(listed.map((item) => item.id)).toContain(event.id);

        if (!details) {
          // An update can still move the event, possibly replacing it under a new id.
          const moved = (
            await provider.doUpdateEvent({
              calendarId,
              eventId: event.id,
              patch: { start: at(0, 11), end: at(0, 12) },
            })
          ).event;
          if (moved.id !== event.id) created.push(moved.id);
          expectValidEvent(moved);
          expectSameTime(moved.start, at(0, 11));
          expectSameTime(moved.end, at(0, 12));
          const stored = (await provider.doGetEvent({ calendarId, eventId: moved.id })).event;
          expectSameTime(stored.start, at(0, 11));

          await provider.doDeleteEvent({ calendarId, eventId: moved.id });
          await expect(provider.doGetEvent({ calendarId, eventId: moved.id })).rejects.toSatisfy(
            NotFoundError.isInstance,
          );
          await expect(
            provider.doUpdateEvent({
              calendarId,
              eventId: moved.id,
              patch: { start: at(0, 13), end: at(0, 14) },
            }),
          ).rejects.toSatisfy(NotFoundError.isInstance);
          return;
        }

        const updated = await provider.doUpdateEvent({
          calendarId,
          eventId: event.id,
          patch: { title: 'calsdk conformance (renamed)', description: 'notes' },
        });
        expectValidEvent(updated.event);
        expect(updated.event).toMatchObject({
          id: event.id,
          title: 'calsdk conformance (renamed)',
          description: 'notes',
        });
        expectSameTime(updated.event.start, input.start);

        const stored = (await provider.doGetEvent({ calendarId, eventId: event.id })).event;
        expect(stored).toMatchObject({
          title: 'calsdk conformance (renamed)',
          description: 'notes',
        });
        expectSameTime(stored.start, input.start);
        expectSameTime(stored.end, input.end);

        await provider.doUpdateEvent({
          calendarId,
          eventId: event.id,
          patch: { description: null },
        });
        const cleared = (await provider.doGetEvent({ calendarId, eventId: event.id })).event;
        expect(cleared.description ?? '').toBe('');
        expect(cleared.title).toBe('calsdk conformance (renamed)');

        await provider.doDeleteEvent({ calendarId, eventId: event.id });
        await expect(provider.doGetEvent({ calendarId, eventId: event.id })).rejects.toSatisfy(
          NotFoundError.isInstance,
        );
        await expect(
          provider.doUpdateEvent({ calendarId, eventId: event.id, patch: { title: 'gone' } }),
        ).rejects.toSatisfy(NotFoundError.isInstance);
      },
      timeout,
    );

    it.runIf(isSupported(capabilities.events.allDay))(
      'round-trips an all-day event with an exclusive end date',
      async () => {
        const start = addDaysToDate(firstDay, 1);
        const end = addDaysToDate(firstDay, 3);
        const event = await create({
          title: 'calsdk all-day',
          start: { date: start },
          end: { date: end },
        });
        expect(event.start).toEqual({ date: start });
        expect(event.end).toEqual({ date: end });

        const fetched = await provider.doGetEvent({ calendarId, eventId: event.id });
        expect(fetched.event.start).toEqual({ date: start });
        expect(fetched.event.end).toEqual({ date: end });
      },
      timeout,
    );

    it(
      'keeps the time zone an event was scheduled in',
      async () => {
        const input = { start: at(1, 15, 'Asia/Kolkata'), end: at(1, 16, 'Asia/Kolkata') };
        const event = await create(input);
        expectSameTime(event.start, input.start);
        const fetched = await provider.doGetEvent({ calendarId, eventId: event.id });
        expectSameTime(fetched.event.start, input.start);
        expectSameTime(fetched.event.end, input.end);
      },
      timeout,
    );

    it(
      'pages through events in start order',
      async () => {
        const ids = new Set<string>();
        for (const hour of [9, 11, 13]) {
          ids.add(
            (
              await create({
                title: `calsdk page ${hour}`,
                start: at(2, hour),
                end: at(2, hour + 1),
              })
            ).id,
          );
        }

        const seen: EventV1[] = [];
        let pageToken: string | undefined;
        let pages = 0;
        do {
          const page = await provider.doListEvents({
            calendarId,
            ...dayRange(2),
            expandRecurring: true,
            pageSize: 2,
            pageToken,
          });
          expect(page.events.length).toBeLessThanOrEqual(2);
          seen.push(...page.events);
          pageToken = page.nextPageToken;
          pages++;
        } while (pageToken && pages < 20);

        expect(pages).toBeGreaterThan(1);
        const ours = seen.filter((event) => ids.has(event.id));
        expect(ours.map((event) => event.id)).toEqual([...ids]);
        expect(new Set(seen.map((event) => event.id)).size).toBe(seen.length);
      },
      timeout,
    );

    it.runIf(isSupported(capabilities.events.etag))(
      'rejects writes with a stale etag',
      async () => {
        const event = await create({ title: 'calsdk etag', start: at(3, 9), end: at(3, 10) });
        expect(event.etag).toEqual(expect.any(String));
        const stale = event.etag;

        const updated = await provider.doUpdateEvent({
          calendarId,
          eventId: event.id,
          patch: { title: 'calsdk etag v2' },
          ifMatch: stale,
        });
        expect(updated.event.etag).not.toBe(stale);

        await expect(
          provider.doUpdateEvent({
            calendarId,
            eventId: event.id,
            patch: { title: 'calsdk etag v3' },
            ifMatch: stale,
          }),
        ).rejects.toSatisfy(ConflictError.isInstance);
        await expect(
          provider.doDeleteEvent({ calendarId, eventId: event.id, ifMatch: stale }),
        ).rejects.toSatisfy(ConflictError.isInstance);
      },
      timeout,
    );

    describe.runIf(isSupported(capabilities.events.recurrence))('recurring events', () => {
      const createDaily = (days: number) =>
        create({
          title: 'calsdk series',
          start: at(days, 10),
          end: at(days, 11),
          recurrence: ['RRULE:FREQ=DAILY;COUNT=5'],
        });
      const instancesOf = async (seriesIds: string[], days: number) =>
        (await list(dayRange(days, days + 7))).filter(
          (event) => event.seriesId !== undefined && seriesIds.includes(event.seriesId),
        );

      it(
        'creates and reads a series',
        async () => {
          const series = await createDaily(21);
          expect(series.kind).toBe('series');
          expect(series.recurrence).toContain('RRULE:FREQ=DAILY;COUNT=5');

          const fetched = (await provider.doGetEvent({ calendarId, eventId: series.id })).event;
          expectValidEvent(fetched);
          expect(fetched.kind).toBe('series');
          expect(fetched.recurrence).toContain('RRULE:FREQ=DAILY;COUNT=5');

          const masters = await list(dayRange(21, 28), false);
          expect(masters.find((event) => event.id === series.id)?.kind).toBe('series');
          expect(masters.filter((event) => event.seriesId === series.id)).toEqual([]);
        },
        timeout,
      );

      it.runIf(isSupported(capabilities.events.serverSideExpansion))(
        'expands a series and modifies or deletes single occurrences',
        async () => {
          const series = await createDaily(7);
          const instances = await instancesOf([series.id], 7);
          expect(instances.map((event) => event.kind)).toEqual(Array(5).fill('occurrence'));
          for (const [index, instance] of instances.entries()) {
            expectSameTime(instance.start, at(7 + index, 10));
            expectSameTime(instance.originalStart, at(7 + index, 10));
          }

          const second = instances[1];
          const third = instances[2];
          if (!second || !third) throw new Error('Expected five occurrences.');
          const changed = await provider.doUpdateEvent({
            calendarId,
            eventId: second.id,
            patch: { title: 'calsdk exception' },
            scope: 'this',
          });
          expectValidEvent(changed.event);
          expect(changed.event).toMatchObject({
            kind: 'exception',
            seriesId: series.id,
            title: 'calsdk exception',
          });
          await provider.doDeleteEvent({ calendarId, eventId: third.id, scope: 'this' });

          const after = await instancesOf([series.id], 7);
          expect(after.map((event) => event.id)).not.toContain(third.id);
          expect(after.map((event) => originalInstant(event))).toEqual(
            [0, 1, 3, 4].map((index) => eventTimeToInstant(at(7 + index, 10))),
          );
          expect(after.map((event) => [event.kind, event.title])).toEqual([
            ['occurrence', 'calsdk series'],
            ['exception', 'calsdk exception'],
            ['occurrence', 'calsdk series'],
            ['occurrence', 'calsdk series'],
          ]);
        },
        timeout,
      );

      it.runIf(
        isSupported(capabilities.events.serverSideExpansion) &&
          isSupported(capabilities.events.recurrenceScopeThisAndFollowing),
      )(
        'applies thisAndFollowing to an occurrence and every later one',
        async () => {
          const series = await createDaily(14);
          const instances = await instancesOf([series.id], 14);
          const second = instances[1];
          const fourth = instances[3];
          if (!second || !fourth) throw new Error('Expected five occurrences.');

          const changed = await provider.doUpdateEvent({
            calendarId,
            eventId: second.id,
            patch: { title: 'calsdk following' },
            scope: 'thisAndFollowing',
          });
          expectValidEvent(changed.event);
          // The provider may split the series: the changed part can have a new id.
          const newSeriesId = changed.event.seriesId ?? changed.event.id;
          if (!created.includes(newSeriesId)) created.push(newSeriesId);

          const afterUpdate = await instancesOf([series.id, newSeriesId], 14);
          expect(afterUpdate.map((event) => eventTimeToInstant(event.start))).toEqual(
            [0, 1, 2, 3, 4].map((index) => eventTimeToInstant(at(14 + index, 10))),
          );
          expect(afterUpdate.map((event) => event.title)).toEqual([
            'calsdk series',
            ...Array(4).fill('calsdk following'),
          ]);

          const following = afterUpdate[3];
          if (!following) throw new Error('Expected a fourth occurrence.');
          await provider.doDeleteEvent({
            calendarId,
            eventId: following.id,
            scope: 'thisAndFollowing',
          });
          const afterDelete = await instancesOf([series.id, newSeriesId], 14);
          expect(afterDelete.map((event) => eventTimeToInstant(event.start))).toEqual(
            [0, 1, 2].map((index) => eventTimeToInstant(at(14 + index, 10))),
          );
          expect(afterDelete.map((event) => event.title)).toEqual([
            'calsdk series',
            'calsdk following',
            'calsdk following',
          ]);
        },
        timeout,
      );
    });

    it.runIf(isSupported(capabilities.sync))(
      'syncs creates, updates and deletes incrementally',
      async () => {
        const { doSyncEvents } = provider;
        if (!doSyncEvents)
          throw new Error('capabilities.sync is true, but doSyncEvents is missing.');
        const sync = async (cursor?: string) => {
          const changes: SyncChangeV1[] = [];
          let pageToken: string | undefined;
          for (let page = 0; page < 100; page++) {
            const result = await doSyncEvents.call(provider, { calendarId, cursor, pageToken });
            changes.push(...result.changes);
            if (result.nextCursor !== undefined) return { changes, cursor: result.nextCursor };
            pageToken = result.nextPageToken;
            if (pageToken === undefined)
              throw new Error('A sync page had neither nextPageToken nor nextCursor.');
          }
          throw new Error('Sync did not finish within 100 pages.');
        };
        const upserted = (changes: SyncChangeV1[], eventId: string) =>
          changes.flatMap((change) =>
            change.type === 'upsert' && change.event.id === eventId ? [change.event] : [],
          );

        const ids = new Set<string>();
        const ours = (changes: SyncChangeV1[]) =>
          changes.filter((change) =>
            ids.has(change.type === 'upsert' ? change.event.id : change.eventId),
          );

        const existing = await create({ title: 'calsdk existing', start: at(4, 7), end: at(4, 8) });
        ids.add(existing.id);
        const initial = await sync();
        expect(upserted(initial.changes, existing.id)).toHaveLength(1);

        const event = await create({ title: 'calsdk sync', start: at(4, 9), end: at(4, 10) });
        ids.add(event.id);
        const afterCreate = await sync(initial.cursor);
        // Incremental: only what changed since the cursor, not the event from before.
        expect(ours(afterCreate.changes)).toEqual([
          { type: 'upsert', event: expect.objectContaining({ id: event.id }) },
        ]);

        const updated = (
          await provider.doUpdateEvent({
            calendarId,
            eventId: event.id,
            patch: details ? { title: 'calsdk sync v2' } : { start: at(4, 11), end: at(4, 12) },
          })
        ).event;
        ids.add(updated.id);
        if (updated.id !== event.id) created.push(updated.id);
        const afterUpdate = await sync(afterCreate.cursor);
        if (updated.id === event.id) {
          expect(ours(afterUpdate.changes)).toEqual([
            {
              type: 'upsert',
              event: expect.objectContaining(
                details ? { id: event.id, title: 'calsdk sync v2' } : { id: event.id },
              ),
            },
          ]);
        } else {
          // A replaced event is the old one deleted and the new one created.
          expect(ours(afterUpdate.changes)).toHaveLength(2);
          expect(ours(afterUpdate.changes)).toEqual(
            expect.arrayContaining([
              { type: 'delete', eventId: event.id },
              { type: 'upsert', event: expect.objectContaining({ id: updated.id }) },
            ]),
          );
        }

        await provider.doDeleteEvent({ calendarId, eventId: updated.id });
        const afterDelete = await sync(afterUpdate.cursor);
        expect(ours(afterDelete.changes)).toEqual([{ type: 'delete', eventId: updated.id }]);
        const quiet = await sync(afterDelete.cursor);
        expect(ours(quiet.changes)).toEqual([]);
        for (const change of [...afterCreate.changes, ...afterUpdate.changes]) {
          if (change.type === 'upsert') expectValidEvent(change.event);
        }
      },
      timeout,
    );

    it.runIf(isSupported(capabilities.freeBusy))(
      'reports busy time and ignores events shown as free',
      async () => {
        if (!provider.doFreeBusy) {
          throw new Error('capabilities.freeBusy is true, but doFreeBusy is missing.');
        }
        await create({ title: 'calsdk busy', start: at(5, 9), end: at(5, 10) });
        await create({ title: 'calsdk free', start: at(5, 11), end: at(5, 12), showAs: 'free' });

        const result = await provider.doFreeBusy({
          calendarIds: [calendarId],
          timeMin: at(5, 8).dateTime,
          timeMax: at(5, 13).dateTime,
        });
        const busy = (result.calendars[calendarId]?.busy ?? []).map((block) => ({
          start: Date.parse(block.start),
          end: Date.parse(block.end),
        }));
        const instant = (hour: number) => eventTimeToInstant(at(5, hour));
        expect(busy.some((block) => block.start <= instant(9) && block.end >= instant(10))).toBe(
          true,
        );
        expect(busy.some((block) => block.start < instant(12) && block.end > instant(11))).toBe(
          false,
        );
      },
      timeout,
    );

    describe.runIf(options.http ?? true)('HTTP', () => {
      const stubbed = (status: number, headers: Record<string, string> = {}) => {
        const requests: Request[] = [];
        const fetch: FetchFunction = async (input, init) => {
          requests.push(new Request(input, init));
          return Response.json(
            { error: { code: status, message: 'stubbed' } },
            { status, headers },
          );
        };
        return { provider: options.createProvider({ fetch }), requests };
      };
      const getEvent = (stub: ReturnType<typeof stubbed>) =>
        stub.provider.doGetEvent({ calendarId, eventId: 'calsdk-conformance' });

      it('maps 401 to AuthenticationError', async () => {
        await expect(getEvent(stubbed(401))).rejects.toSatisfy(AuthenticationError.isInstance);
      });

      it('maps 403 to PermissionDeniedError', async () => {
        await expect(getEvent(stubbed(403))).rejects.toSatisfy(PermissionDeniedError.isInstance);
      });

      it('maps 404 to NotFoundError', async () => {
        await expect(getEvent(stubbed(404))).rejects.toSatisfy(NotFoundError.isInstance);
      });

      it('maps 429 to RateLimitError with Retry-After', async () => {
        await expect(getEvent(stubbed(429, { 'retry-after': '7' }))).rejects.toSatisfy(
          (error) => RateLimitError.isInstance(error) && error.retryAfterMs === 7000,
        );
      });

      it.runIf(isSupported(capabilities.events.etag))(
        'maps 412 on a conditional write to ConflictError',
        async () => {
          const stub = stubbed(412);
          await expect(
            stub.provider.doUpdateEvent({
              calendarId,
              eventId: 'calsdk-conformance',
              patch: { title: 'x' },
              ifMatch: '"stale"',
            }),
          ).rejects.toSatisfy(ConflictError.isInstance);
        },
      );

      it('sends custom headers and the abort signal with every request', async () => {
        const stub = stubbed(404);
        const controller = new AbortController();
        await expect(
          stub.provider.doGetEvent({
            calendarId,
            eventId: 'calsdk-conformance',
            headers: { 'x-calsdk-conformance': '1' },
            abortSignal: controller.signal,
          }),
        ).rejects.toSatisfy(NotFoundError.isInstance);
        // Requests built with a signal follow it, so aborting now shows whether it was passed.
        controller.abort();
        expect(stub.requests.length).toBeGreaterThan(0);
        for (const request of stub.requests) {
          expect(request.headers.get('x-calsdk-conformance')).toBe('1');
          expect(request.signal.aborted).toBe(true);
        }
      });
    });
  });
}

function originalInstant(event: EventV1): number {
  return eventTimeToInstant(event.originalStart ?? event.start);
}

function isSupported(capability: CapabilityV1): boolean {
  return capability === true;
}

/** Same instant and same time zone, or the same date for all-day times. */
function expectSameTime(actual: EventTimeV1 | undefined, expected: EventTimeV1) {
  if (actual === undefined || isAllDay(expected)) {
    expect(actual).toEqual(expected);
    return;
  }
  expect(actual.dateTime).toEqual(expect.any(String));
  expect(Date.parse(actual.dateTime ?? '')).toBe(Date.parse(expected.dateTime));
  expect(canonicalZone(actual.timeZone ?? '')).toBe(canonicalZone(expected.timeZone));
}

// Engines disagree on canonical names (Asia/Calcutta vs Asia/Kolkata), so compare
// what this engine resolves both names to.
function canonicalZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
}

/** Invariants every event a provider returns must satisfy. */
function expectValidEvent(event: EventV1) {
  expect(event.id).toEqual(expect.any(String));
  expect(event.id).not.toBe('');
  expect(isAllDay(event.start)).toBe(isAllDay(event.end));
  for (const time of [event.start, event.end, event.originalStart]) {
    if (time === undefined || isAllDay(time)) continue;
    expect(time.dateTime).toMatch(OFFSET);
    expect(isValidTimeZone(time.timeZone)).toBe(true);
  }
  expect(eventTimeToInstant(event.end)).toBeGreaterThan(eventTimeToInstant(event.start));
  expect(['confirmed', 'tentative', 'cancelled']).toContain(event.status);
  expect(['busy', 'free']).toContain(event.showAs);

  switch (event.kind) {
    case 'single':
      expect(event.seriesId).toBeUndefined();
      expect(event.recurrence).toBeUndefined();
      break;
    case 'series':
      expect(event.seriesId).toBeUndefined();
      expect(event.recurrence?.length).toBeGreaterThan(0);
      break;
    case 'occurrence':
    case 'exception':
      expect(event.seriesId).toEqual(expect.any(String));
      expect(event.originalStart).toBeDefined();
      expect(event.recurrence).toBeUndefined();
      break;
    default:
      throw new Error(`Unknown event kind: ${String(event.kind satisfies never)}`);
  }
}
