import { mockCalendar } from '@calsdk/mock';
import type { CalendarProviderV1 } from '@calsdk/provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeBusyUnavailableError } from './errors/free-busy-unavailable-error';
import { findFreeTime } from './find-free-time';
import { getFreeBusy } from './get-free-busy';

beforeEach(() => {
  globalThis.CALSDK_WARNINGS = 'silent';
});
afterEach(() => {
  globalThis.CALSDK_WARNINGS = undefined;
});

const kolkata = (time: string, date = '2026-11-02') => ({
  dateTime: `${date}T${time}:00+05:30`,
  timeZone: 'Asia/Kolkata',
});
const busyAt = (start: string, end: string, extra = {}) => ({
  start: kolkata(start),
  end: kolkata(end),
  ...extra,
});

describe('getFreeBusy', () => {
  it('computes busy blocks from events when the provider has no free/busy', async () => {
    const calendar = mockCalendar({
      calendars: [{ id: 'cal_1', timeZone: 'Asia/Kolkata' }],
      events: [
        busyAt('10:00', '11:00'),
        busyAt('10:30', '12:00'),
        busyAt('13:00', '14:00', { showAs: 'free' }),
        { start: { date: '2026-11-03' }, end: { date: '2026-11-04' } },
      ],
    });

    const result = await getFreeBusy({
      calendar,
      calendarIds: ['primary', 'missing'],
      timeMin: '2026-11-02T00:00:00Z',
      timeMax: '2026-11-03T12:00:00Z',
    });

    expect(result.calendars.primary).toEqual({
      busy: [
        { start: '2026-11-02T04:30:00.000Z', end: '2026-11-02T06:30:00.000Z' },
        // The all-day event blocks the 3rd in the calendar's zone, clipped to timeMax.
        { start: '2026-11-02T18:30:00.000Z', end: '2026-11-03T12:00:00.000Z' },
      ],
    });
    expect(result.calendars.missing?.error).toBeDefined();
    expect(result.warnings).toEqual([expect.objectContaining({ type: 'compatibility' })]);
  });

  it('blocks all-day events conservatively when the calendar zone is unknown', async () => {
    const mock = mockCalendar({
      events: [{ start: { date: '2026-11-03' }, end: { date: '2026-11-04' } }],
    });
    const pageWarning = { type: 'other', message: 'from the provider' } as const;
    const calendar: CalendarProviderV1 = {
      ...mock,
      doListCalendars: async () => ({
        calendars: [{ id: 'primary', name: 'Primary', isPrimary: true, accessRole: 'owner' }],
        warnings: [],
      }),
      doListEvents: async (options) => {
        const page = await mock.doListEvents(options);
        return { ...page, warnings: [pageWarning] };
      },
    };

    const result = await getFreeBusy({
      calendar,
      timeMin: '2026-11-02T00:00:00Z',
      timeMax: '2026-11-05T00:00:00Z',
    });
    // From the earliest zone's start of the 3rd (UTC+14) to the latest's end (UTC-12).
    expect(result.calendars.primary).toEqual({
      busy: [{ start: '2026-11-02T10:00:00.000Z', end: '2026-11-04T12:00:00.000Z' }],
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'compatibility', feature: 'freeBusy' }),
      pageWarning,
      expect.objectContaining({ type: 'compatibility', feature: 'allDayEvents' }),
    ]);
  });

  it('does not read inherited keys from a native response', async () => {
    const calendar: CalendarProviderV1 = {
      ...mockCalendar(),
      doFreeBusy: async () => ({ calendars: {}, warnings: [] }),
    };
    const result = await getFreeBusy({
      calendar,
      calendarIds: ['__proto__', 'toString'],
      timeMin: '2026-11-02T00:00:00Z',
      timeMax: '2026-11-02T12:00:00Z',
    });
    expect(Object.keys(result.calendars)).toEqual(['__proto__', 'toString']);
    expect(Object.values(result.calendars)).toEqual([
      { busy: [], error: expect.any(String) },
      { busy: [], error: expect.any(String) },
    ]);
  });

  it('merges, sorts and clips native free/busy blocks', async () => {
    const calendar: CalendarProviderV1 = {
      ...mockCalendar(),
      doFreeBusy: async () => ({
        calendars: {
          a: {
            busy: [
              { start: '2026-11-02T11:00:00Z', end: '2026-11-02T13:00:00Z' },
              { start: '2026-11-01T23:00:00Z', end: '2026-11-02T01:00:00Z' },
              { start: '2026-11-02T10:00:00Z', end: '2026-11-02T11:00:00Z' },
            ],
          },
        },
        warnings: [],
      }),
    };
    const result = await getFreeBusy({
      calendar,
      calendarIds: ['a', 'b'],
      timeMin: '2026-11-02T00:00:00Z',
      timeMax: '2026-11-02T12:00:00Z',
    });
    expect(result.calendars).toEqual({
      a: {
        busy: [
          { start: '2026-11-02T00:00:00.000Z', end: '2026-11-02T01:00:00.000Z' },
          { start: '2026-11-02T10:00:00.000Z', end: '2026-11-02T12:00:00.000Z' },
        ],
      },
      b: { busy: [], error: expect.any(String) },
    });
  });
});

describe('findFreeTime', () => {
  // 2026-11-02 is a Monday.
  const day = { timeMin: '2026-11-01T18:30:00Z', timeMax: '2026-11-02T18:30:00Z' };
  const workingHours = { start: '09:00', end: '13:00', timeZone: 'Asia/Kolkata' };

  it('finds slots free in every calendar, inside working hours', async () => {
    const { slots } = await findFreeTime({
      calendars: [
        { calendar: mockCalendar({ events: [busyAt('09:00', '10:00')] }) },
        { calendar: mockCalendar({ events: [busyAt('11:00', '11:30')] }) },
      ],
      ...day,
      duration: 60,
      slotInterval: 30,
      workingHours,
    });
    expect(slots.map((slot) => slot.start)).toEqual([
      '2026-11-02T04:30:00.000Z', // 10:00
      '2026-11-02T06:00:00.000Z', // 11:30
      '2026-11-02T06:30:00.000Z', // 12:00
    ]);
  });

  it('aligns slots to the interval and skips non-working days', async () => {
    const { slots } = await findFreeTime({
      calendars: [{ calendar: mockCalendar() }],
      timeMin: '2026-11-02T06:07:00Z', // 11:37 in Kolkata
      timeMax: '2026-11-09T00:00:00Z',
      duration: 30,
      workingHours: { ...workingHours, days: [1] },
    });
    expect(slots[0]?.start).toBe('2026-11-02T06:15:00.000Z'); // 11:45
    expect(slots.at(-1)?.end).toBe('2026-11-02T07:30:00.000Z'); // 13:00, then Tuesday is skipped
  });

  // On 2026-03-08 New York skips 02:00-03:00. On 2026-11-01 it repeats 01:00-02:00.
  const newYork = (start: string, end: string) => ({
    calendars: [{ calendar: mockCalendar() }],
    duration: 30,
    slotInterval: 30,
    workingHours: { start, end, timeZone: 'America/New_York', days: [0] },
  });

  it('never places slots in an hour skipped by DST', async () => {
    const { slots } = await findFreeTime({
      ...newYork('01:00', '02:30'),
      timeMin: '2026-03-08T00:00:00Z',
      timeMax: '2026-03-09T00:00:00Z',
    });
    expect(slots).toEqual([
      { start: '2026-03-08T06:00:00.000Z', end: '2026-03-08T06:30:00.000Z' }, // 01:00 EST
      { start: '2026-03-08T06:30:00.000Z', end: '2026-03-08T07:00:00.000Z' }, // 01:30 EST
    ]);
  });

  it('offers both runs of an hour repeated by DST', async () => {
    const { slots } = await findFreeTime({
      ...newYork('00:00', '01:30'),
      timeMin: '2026-11-01T00:00:00Z',
      timeMax: '2026-11-02T00:00:00Z',
    });
    expect(slots.map((slot) => slot.start)).toEqual([
      '2026-11-01T04:00:00.000Z', // 00:00 EDT
      '2026-11-01T04:30:00.000Z', // 00:30 EDT
      '2026-11-01T05:00:00.000Z', // 01:00 EDT
      '2026-11-01T06:00:00.000Z', // 01:00 EST
    ]);
  });

  it('keeps slots that span a repeated hour inside working hours', async () => {
    const { slots } = await findFreeTime({
      ...newYork('00:00', '03:00'),
      duration: 60,
      timeMin: '2026-11-01T00:00:00Z',
      timeMax: '2026-11-02T00:00:00Z',
    });
    expect(slots.map((slot) => slot.start)).toEqual([
      '2026-11-01T04:00:00.000Z', // 00:00 EDT
      '2026-11-01T04:30:00.000Z',
      '2026-11-01T05:00:00.000Z', // 01:00 EDT
      '2026-11-01T05:30:00.000Z', // 01:30 EDT, ends 01:30 EST
      '2026-11-01T06:00:00.000Z', // 01:00 EST
      '2026-11-01T06:30:00.000Z',
      '2026-11-01T07:00:00.000Z', // 02:00 EST, ends 03:00
    ]);
  });

  it('rejects slots that leave working hours through a repeated hour', async () => {
    const { slots } = await findFreeTime({
      ...newYork('01:30', '02:00'),
      duration: 90,
      timeMin: '2026-11-01T00:00:00Z',
      timeMax: '2026-11-02T00:00:00Z',
    });
    // 01:30 EDT to 02:00 EST passes through 01:00-01:30 EST.
    expect(slots).toEqual([]);
  });

  it('stays on the hour after a half-hour DST change', async () => {
    const { slots } = await findFreeTime({
      calendars: [{ calendar: mockCalendar() }],
      timeMin: '2026-10-03T12:00:00Z',
      timeMax: '2026-10-04T12:00:00Z',
      duration: 60,
      slotInterval: 60,
      // Lord Howe Island moves from +10:30 to +11:00 at 02:00 on 2026-10-04.
      workingHours: { start: '09:00', end: '12:00', timeZone: 'Australia/Lord_Howe', days: [0] },
    });
    expect(slots.map((slot) => slot.start)).toEqual([
      '2026-10-03T22:00:00.000Z', // 09:00
      '2026-10-03T23:00:00.000Z', // 10:00
      '2026-10-04T00:00:00.000Z', // 11:00
    ]);
  });

  it('aligns slots to the hour, not to the working-hours start', async () => {
    const { slots } = await findFreeTime({
      calendars: [{ calendar: mockCalendar() }],
      ...day,
      duration: 30,
      slotInterval: 30,
      workingHours: { ...workingHours, start: '09:10', end: '10:30' },
    });
    expect(slots.map((slot) => slot.start)).toEqual([
      '2026-11-02T04:00:00.000Z', // 09:30
      '2026-11-02T04:30:00.000Z', // 10:00
    ]);
  });

  it('forwards per-provider headers and provider options', async () => {
    const mock = mockCalendar();
    const doFreeBusy = vi.fn<NonNullable<CalendarProviderV1['doFreeBusy']>>(async () => ({
      calendars: { primary: { busy: [] } },
      warnings: [],
    }));
    await findFreeTime({
      calendars: [
        {
          calendar: { ...mock, doFreeBusy },
          headers: { 'x-trace': '1' },
          providerOptions: { mock: { flag: true } },
        },
      ],
      ...day,
      duration: 30,
    });
    expect(doFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-trace': '1' },
        providerOptions: { mock: { flag: true } },
      }),
    );
  });

  it('throws when a calendar cannot be read', async () => {
    await expect(
      findFreeTime({
        calendars: [{ calendar: mockCalendar(), calendarIds: ['primary', 'missing'] }],
        ...day,
        duration: 30,
      }),
    ).rejects.toSatisfy(FreeBusyUnavailableError.isInstance);
  });
});
