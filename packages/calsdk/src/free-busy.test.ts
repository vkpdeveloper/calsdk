import { mockCalendar } from '@calsdk/mock';
import type { CalendarProviderV1 } from '@calsdk/provider';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
