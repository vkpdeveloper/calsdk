import { mockCalendar } from '@calsdk/mock';
import {
  APICallError,
  type CalendarProviderV1,
  InvalidArgumentError,
  NoSuchProviderVersionError,
  NotFoundError,
} from '@calsdk/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent } from './create-event';
import { deleteEvent } from './delete-event';
import { getEvent } from './get-event';
import { iterateEvents, listEvents } from './list-events';
import { updateEvent } from './update-event';

afterEach(() => {
  globalThis.CALSDK_WARNINGS = undefined;
});

const range = { timeMin: '2026-11-01T00:00:00Z', timeMax: '2026-12-01T00:00:00Z' };
const daily = () =>
  mockCalendar({
    events: [
      {
        title: 'Daily',
        start: { dateTime: '2026-11-02T09:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-11-02T09:15:00Z', timeZone: 'UTC' },
        recurrence: ['RRULE:FREQ=DAILY;COUNT=5'],
      },
    ],
  });

describe('event functions', () => {
  it('create, get, update and delete on the primary calendar by default', async () => {
    const calendar = mockCalendar();
    const { event } = await createEvent({
      calendar,
      event: {
        title: 'Design review',
        start: { dateTime: '2026-11-03T10:00:00', timeZone: 'Asia/Kolkata' },
        end: { dateTime: '2026-11-03T10:30:00', timeZone: 'Asia/Kolkata' },
      },
    });
    expect(event.start).toEqual({
      dateTime: '2026-11-03T10:00:00+05:30',
      timeZone: 'Asia/Kolkata',
    });

    const fetched = await getEvent({ calendar, eventId: event.id });
    expect(fetched.event.title).toBe('Design review');

    const updated = await updateEvent({
      calendar,
      eventId: event.id,
      patch: { title: 'Renamed' },
      ifMatch: fetched.event.etag,
    });
    expect(updated.event.title).toBe('Renamed');

    await deleteEvent({ calendar, eventId: event.id });
    await expect(getEvent({ calendar, eventId: event.id })).rejects.toSatisfy(
      NotFoundError.isInstance,
    );
  });

  it('expands recurring events by default and walks every page', async () => {
    const calendar = daily();
    const { events, nextPageToken } = await listEvents({ calendar, ...range, pageSize: 2 });
    expect(events.map((event) => event.kind)).toEqual(['occurrence', 'occurrence']);
    expect(nextPageToken).toBeDefined();

    const all = [];
    for await (const event of iterateEvents({ calendar, ...range, pageSize: 2 })) all.push(event);
    expect(all).toHaveLength(5);
  });

  it('rejects invalid input before calling the provider', async () => {
    const calendar = mockCalendar();
    const spy = vi.spyOn(calendar, 'doListEvents');
    await expect(
      listEvents({ calendar, timeMin: range.timeMax, timeMax: range.timeMin }),
    ).rejects.toSatisfy(InvalidArgumentError.isInstance);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects missing providers and unknown contract versions', async () => {
    await expect(
      listEvents({ calendar: undefined as unknown as CalendarProviderV1, ...range }),
    ).rejects.toSatisfy(
      (error) => InvalidArgumentError.isInstance(error) && error.argument === 'calendar',
    );
    const future = {
      ...mockCalendar(),
      specificationVersion: 'v2',
    } as unknown as CalendarProviderV1;
    await expect(listEvents({ calendar: future, ...range })).rejects.toSatisfy(
      NoSuchProviderVersionError.isInstance,
    );
  });

  it('treats NotFound on a retried delete as success', async () => {
    const calendar = mockCalendar();
    const flaky = {
      ...calendar,
      doDeleteEvent: vi
        .fn<CalendarProviderV1['doDeleteEvent']>()
        .mockRejectedValueOnce(
          new APICallError({ message: 'timeout', url: 'https://x', isRetryable: true }),
        )
        .mockRejectedValueOnce(new NotFoundError({ provider: 'mock', resource: 'event', id: 'e' })),
    };
    vi.useFakeTimers();
    const result = deleteEvent({ calendar: flaky, eventId: 'e' });
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await expect(result).resolves.toEqual(expect.objectContaining({ warnings: [] }));
  });

  it('reports warnings through the global setting', async () => {
    const handler = vi.fn();
    globalThis.CALSDK_WARNINGS = handler;
    const calendar = mockCalendar();
    const warning = { type: 'other', message: 'heads up' } as const;
    const withWarning = {
      ...calendar,
      doListEvents: async () => ({ events: [], warnings: [warning] }),
    };

    const result = await listEvents({ calendar: withWarning, ...range });
    expect(result.warnings).toEqual([warning]);
    expect(handler).toHaveBeenCalledWith([warning], { provider: 'mock', operation: 'listEvents' });
  });
});
