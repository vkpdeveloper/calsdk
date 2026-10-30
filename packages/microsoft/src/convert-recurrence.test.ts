import { UnsupportedFunctionalityError } from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { fromGraphRecurrence, toGraphRecurrence } from './convert-recurrence';

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

  it.each([
    ['EXDATE', ['RRULE:FREQ=DAILY', 'EXDATE:20300201T150000Z']],
    ['HOURLY', ['RRULE:FREQ=HOURLY']],
    ['a day past the 28th', ['RRULE:FREQ=MONTHLY;BYMONTHDAY=31']],
    ['a start past the 28th without BYMONTHDAY', ['RRULE:FREQ=MONTHLY']],
    ['different nth weekdays', ['RRULE:FREQ=MONTHLY;BYDAY=1MO,2TU']],
    ['BYHOUR', ['RRULE:FREQ=DAILY;BYHOUR=9']],
  ])('refuses rules Outlook would schedule differently: %s', (_, lines) => {
    expect(() => toGraphRecurrence(lines, start)).toThrow(
      expect.toSatisfy(UnsupportedFunctionalityError.isInstance),
    );
  });
});
