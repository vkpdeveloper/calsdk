import { UnsupportedFunctionalityError, type WarningV1 } from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { fromGraphRecurrence, shiftRecurrence, toGraphRecurrence } from './convert-recurrence';
import type { GraphRecurrence, GraphWeekday } from './microsoft-api';

const start = { dateTime: '2030-01-31T10:00:00-05:00', timeZone: 'America/New_York' };

describe('Outlook recurrence', () => {
  it.each([
    'RRULE:FREQ=DAILY;INTERVAL=3;COUNT=5',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,TH;WKST=SU',
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=15',
    'RRULE:FREQ=MONTHLY;BYDAY=2TH',
    'RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    // Outlook moves the 31st to the last day of shorter months.
    'RRULE:FREQ=MONTHLY;COUNT=4;BYMONTHDAY=28,29,30,31;BYSETPOS=-1',
    'RRULE:FREQ=YEARLY;BYDAY=-1FR;BYMONTH=1',
  ])('round-trips %s', (rule) => {
    expect(fromGraphRecurrence(toGraphRecurrence([rule], start), start)).toEqual([rule]);
  });

  it('ends on the last date an occurrence fits before UNTIL', () => {
    // Occurrences are at 15:00 UTC, so an UNTIL of 14:00 UTC on March 4 excludes March 4.
    const recurrence = toGraphRecurrence(['RRULE:FREQ=DAILY;UNTIL=20300304T140000Z'], start);
    expect(recurrence.range).toMatchObject({ type: 'endDate', endDate: '2030-03-03' });
    expect(fromGraphRecurrence(recurrence, start)).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20300303T150000Z',
    ]);
  });

  it('keeps all-day ranges as dates', () => {
    const allDay = { date: '2030-01-07' };
    const recurrence = toGraphRecurrence(['RRULE:FREQ=WEEKLY;UNTIL=20300204'], allDay);
    expect(recurrence).toMatchObject({
      pattern: { type: 'weekly', daysOfWeek: ['monday'] },
      range: { startDate: '2030-01-07', endDate: '2030-02-04' },
    });
    expect(fromGraphRecurrence(recurrence, allDay)).toEqual([
      'RRULE:FREQ=WEEKLY;UNTIL=20300204;BYDAY=MO',
    ]);
  });

  it('keeps EXDATE lines only for deleted occurrences', () => {
    const lines = ['RRULE:FREQ=DAILY;COUNT=5', 'EXDATE:20300201T150000Z'];
    const cancelled = ['2030-02-01'];
    const recurrence = toGraphRecurrence(lines, start, { cancelled });
    expect(fromGraphRecurrence(recurrence, start, cancelled)).toEqual(lines);
    // Outlook cannot exclude an occurrence that was not deleted.
    expect(() => toGraphRecurrence(lines, start)).toThrow(
      expect.toSatisfy(UnsupportedFunctionalityError.isInstance),
    );
    // Nor exclude another time on a deleted occurrence's date.
    expect(() =>
      toGraphRecurrence(['RRULE:FREQ=DAILY;COUNT=5', 'EXDATE:20300201T160000Z'], start, {
        cancelled,
      }),
    ).toThrow(expect.toSatisfy(UnsupportedFunctionalityError.isInstance));
    // Nor bring a deleted one back.
    const warnings: WarningV1[] = [];
    toGraphRecurrence(['RRULE:FREQ=DAILY;COUNT=5'], start, { cancelled, warnings });
    expect(warnings).toMatchObject([{ type: 'unsupported', feature: 'recurrence' }]);
  });

  it('moves weekly series to other weekdays', () => {
    const weekly = (daysOfWeek: GraphWeekday[], interval = 1): GraphRecurrence => ({
      pattern: { type: 'weekly', interval, daysOfWeek, firstDayOfWeek: 'sunday' },
      range: { type: 'endDate', startDate: '2030-01-05', endDate: '2030-03-30' },
    });
    expect(shiftRecurrence(weekly(['saturday']), 1)).toEqual({
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['sunday'], firstDayOfWeek: 'sunday' },
      range: { type: 'endDate', startDate: '2030-01-06', endDate: '2030-03-31' },
    });
    // Every other week, Saturday would move into the next week while Friday stays.
    expect(() => shiftRecurrence(weekly(['friday', 'saturday'], 2), 1)).toThrow(
      expect.toSatisfy(UnsupportedFunctionalityError.isInstance),
    );
    const monthly: GraphRecurrence = {
      pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 5 },
      range: { type: 'noEnd', startDate: '2030-01-05' },
    };
    expect(() => shiftRecurrence(monthly, 1)).toThrow(
      expect.toSatisfy(UnsupportedFunctionalityError.isInstance),
    );
  });

  it.each([
    ['HOURLY', ['RRULE:FREQ=HOURLY']],
    ['a day past the 28th', ['RRULE:FREQ=MONTHLY;BYMONTHDAY=31']],
    ['a start past the 28th without BYMONTHDAY', ['RRULE:FREQ=MONTHLY']],
    ['different nth weekdays', ['RRULE:FREQ=MONTHLY;BYDAY=1MO,2TU']],
    ['BYHOUR', ['RRULE:FREQ=DAILY;BYHOUR=9']],
    // Without BYMONTH this is the 7th of every month.
    ['YEARLY BYMONTHDAY without BYMONTH', ['RRULE:FREQ=YEARLY;BYMONTHDAY=7']],
  ])('refuses rules Outlook would schedule differently: %s', (_, lines) => {
    expect(() => toGraphRecurrence(lines, start)).toThrow(
      expect.toSatisfy(UnsupportedFunctionalityError.isInstance),
    );
  });
});
