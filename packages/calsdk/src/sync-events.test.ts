import { mockCalendar } from '@calsdk/mock';
import {
  type CalendarProviderV1,
  InvalidResponseDataError,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { createEvent } from './create-event';
import { syncEvents } from './sync-events';

const allDay = (title: string, day: number) => ({
  title,
  start: { date: `2026-11-${10 + day}` },
  end: { date: `2026-11-${11 + day}` },
});

describe('syncEvents', () => {
  it('follows every page, then syncs incrementally from the cursor', async () => {
    const calendar = mockCalendar({
      defaultPageSize: 1,
      events: [allDay('A', 0), allDay('B', 1)],
    });

    const initial = await syncEvents({ calendar });
    expect(initial.changes.map((c) => c.type === 'upsert' && c.event.title)).toEqual(['A', 'B']);

    await createEvent({ calendar, event: allDay('C', 2) });
    const next = await syncEvents({ calendar, cursor: initial.nextCursor });
    expect(next.changes.map((c) => c.type === 'upsert' && c.event.title)).toEqual(['C']);
  });

  it('returns one page with paginate: false', async () => {
    const calendar = mockCalendar({
      defaultPageSize: 1,
      events: [allDay('A', 0), allDay('B', 1)],
    });
    const first = await syncEvents({ calendar, paginate: false });
    expect(first.changes).toHaveLength(1);
    expect(first.nextCursor).toBeUndefined();

    const last = await syncEvents({ calendar, paginate: false, pageToken: first.nextPageToken });
    expect(last.changes).toHaveLength(1);
    expect(last.nextCursor).toBeDefined();
  });

  it('accepts paginate as a runtime boolean', async () => {
    const calendar = mockCalendar({ events: [allDay('A', 0)] });
    const paginate = Math.random() > 2; // A boolean the compiler cannot narrow.
    const result = await syncEvents({ calendar, paginate });
    expect(result.changes).toHaveLength(1);
  });

  it('throws UnsupportedFunctionalityError when the provider cannot sync', async () => {
    const { doSyncEvents: _, ...calendar } = mockCalendar();
    await expect(syncEvents({ calendar })).rejects.toSatisfy(
      UnsupportedFunctionalityError.isInstance,
    );
  });

  it.each([
    ['neither token', { changes: [], warnings: [] }],
    ['the same token twice', { changes: [], nextPageToken: 'again', warnings: [] }],
  ])('rejects a provider page with %s', async (_, page) => {
    const calendar: CalendarProviderV1 = { ...mockCalendar(), doSyncEvents: async () => page };
    await expect(syncEvents({ calendar })).rejects.toSatisfy(InvalidResponseDataError.isInstance);
  });
});
