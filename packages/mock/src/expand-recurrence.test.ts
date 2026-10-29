import { UnsupportedFunctionalityError } from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { expandInRange, iterateInstances, type RecurringEvent } from './expand-recurrence';

const timed = (recurrence: string[], start = '2026-11-02T10:00:00+05:30'): RecurringEvent => ({
  start: { dateTime: start, timeZone: 'Asia/Kolkata' },
  end: {
    dateTime: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
    timeZone: 'Asia/Kolkata',
  },
  recurrence,
});

const starts = (event: RecurringEvent, limit = 20) => {
  const result: string[] = [];
  for (const instance of iterateInstances(event, 'UTC')) {
    result.push('date' in instance.start ? instance.start.date : instance.start.dateTime);
    if (result.length >= limit) break;
  }
  return result;
};

describe('iterateInstances', () => {
  it('expands DAILY with INTERVAL and COUNT', () => {
    expect(starts(timed(['RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3']))).toEqual([
      '2026-11-02T10:00:00+05:30',
      '2026-11-04T10:00:00+05:30',
      '2026-11-06T10:00:00+05:30',
    ]);
  });

  it('expands WEEKLY with BYDAY and UNTIL (inclusive)', () => {
    // 2026-11-02 is a Monday.
    expect(starts(timed(['RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261112T043000Z']))).toEqual([
      '2026-11-02T10:00:00+05:30',
      '2026-11-05T10:00:00+05:30',
      '2026-11-09T10:00:00+05:30',
      '2026-11-12T10:00:00+05:30',
    ]);
  });

  it('expands every other week relative to the series start week', () => {
    expect(starts(timed(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=3']))).toEqual([
      '2026-11-02T10:00:00+05:30', // the series start always counts
      '2026-11-04T10:00:00+05:30',
      '2026-11-18T10:00:00+05:30',
    ]);
  });

  it('expands MONTHLY by month day, skipping months without it', () => {
    expect(starts(timed(['RRULE:FREQ=MONTHLY;COUNT=4'], '2027-01-31T09:00:00+05:30'))).toEqual([
      '2027-01-31T09:00:00+05:30',
      '2027-03-31T09:00:00+05:30',
      '2027-05-31T09:00:00+05:30',
      '2027-07-31T09:00:00+05:30',
    ]);
  });

  it('expands MONTHLY by numbered weekday, including the last one', () => {
    expect(
      starts(timed(['RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3'], '2026-11-27T10:00:00+05:30')),
    ).toEqual([
      '2026-11-27T10:00:00+05:30',
      '2026-12-25T10:00:00+05:30',
      '2027-01-29T10:00:00+05:30',
    ]);
  });

  it('removes EXDATEs but still counts them toward COUNT', () => {
    expect(
      starts(
        timed([
          'RRULE:FREQ=DAILY;COUNT=4',
          'EXDATE;TZID=Asia/Kolkata:20261103T100000',
          'EXDATE:20261104T043000Z',
        ]),
      ),
    ).toEqual(['2026-11-02T10:00:00+05:30', '2026-11-05T10:00:00+05:30']);
  });

  it('keeps the wall-clock time across DST changes', () => {
    const event: RecurringEvent = {
      start: { dateTime: '2026-10-30T09:00:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-30T10:00:00-04:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
    };
    expect(starts(event)).toEqual(['2026-10-30T09:00:00-04:00', '2026-11-06T09:00:00-05:00']);
  });

  it('expands all-day events by date', () => {
    const event: RecurringEvent = {
      start: { date: '2026-12-31' },
      end: { date: '2027-01-01' },
      recurrence: ['RRULE:FREQ=YEARLY;UNTIL=20281231', 'EXDATE;VALUE=DATE:20271231'],
    };
    const instances = [...iterateInstances(event, 'UTC')];
    expect(instances.map((instance) => instance.start)).toEqual([
      { date: '2026-12-31' },
      { date: '2028-12-31' },
    ]);
    expect(instances[1]?.end).toEqual({ date: '2029-01-01' });
  });

  it('stops rules that can never match again', () => {
    const event = timed(['RRULE:FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30']);
    expect(starts(event)).toEqual(['2026-11-02T10:00:00+05:30']);
  });

  it.each([
    'RRULE:FREQ=HOURLY',
    'RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1',
    'RRULE:FREQ=DAILY;BYHOUR=9',
    'RRULE:FREQ=WEEKLY;BYDAY=1MO',
  ])('rejects %s', (line) => {
    expect(() => [...iterateInstances(timed([line]), 'UTC')]).toThrow(
      UnsupportedFunctionalityError,
    );
  });
});

describe('expandInRange', () => {
  it('returns instances overlapping the range', () => {
    const event = timed(['RRULE:FREQ=DAILY']);
    const instances = expandInRange(
      event,
      'UTC',
      Date.parse('2026-11-03T04:45:00Z'), // inside the Nov 3 instance
      Date.parse('2026-11-05T04:30:00Z'), // exactly at the Nov 5 start: excluded
    );
    expect(instances.map((instance) => instance.start)).toEqual([
      { dateTime: '2026-11-03T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
      { dateTime: '2026-11-04T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
    ]);
  });
});
