import { InvalidArgumentError, UnsupportedFunctionalityError } from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import {
  assertSupportedRecurrence,
  expandInRange,
  instancesBetween,
  type RecurringEvent,
} from './expand-recurrence';

const timed = (recurrence: string[], start = '2026-11-02T10:00:00+05:30'): RecurringEvent => ({
  start: { dateTime: start, timeZone: 'Asia/Kolkata' },
  end: {
    dateTime: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
    timeZone: 'Asia/Kolkata',
  },
  recurrence,
});

const all = (event: RecurringEvent) =>
  instancesBetween(event, 'UTC', Date.parse('2000-01-01'), Date.parse('2040-01-01'));

const starts = (event: RecurringEvent, limit = 20) =>
  all(event)
    .slice(0, limit)
    .map(({ start }) => ('date' in start ? start.date : start.dateTime));

describe('instancesBetween', () => {
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
    const instances = all(event);
    expect(instances.map((instance) => instance.start)).toEqual([
      { date: '2026-12-31' },
      { date: '2028-12-31' },
    ]);
    expect(instances[1]?.end).toEqual({ date: '2029-01-01' });
  });

  it('finds sparse rules such as leap days', () => {
    const event: RecurringEvent = {
      start: { date: '2024-02-29' },
      end: { date: '2024-03-01' },
      recurrence: ['RRULE:FREQ=YEARLY;COUNT=3'],
    };
    expect(starts(event)).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
  });

  it('expands YEARLY BYMONTHDAY into every month', () => {
    expect(
      starts(timed(['RRULE:FREQ=YEARLY;BYMONTHDAY=15;COUNT=3'], '2027-01-15T09:00:00+05:30')),
    ).toEqual([
      '2027-01-15T09:00:00+05:30',
      '2027-02-15T09:00:00+05:30',
      '2027-03-15T09:00:00+05:30',
    ]);
  });

  it('skips wall-clock times that DST removes, without counting them', () => {
    const event: RecurringEvent = {
      start: { dateTime: '2026-03-07T02:30:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-03-07T03:00:00-05:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=DAILY;COUNT=2'],
    };
    expect(starts(event)).toEqual(['2026-03-07T02:30:00-05:00', '2026-03-09T02:30:00-04:00']);
  });

  it('keeps a series start in the second half of a DST fold', () => {
    // 01:30 happens twice on 2026-11-01 in New York; this is the later one.
    const event: RecurringEvent = {
      start: { dateTime: '2026-11-01T01:30:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-01T02:00:00-05:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=DAILY;COUNT=2'],
    };
    expect(all(event)[0]?.startInstant).toBe(Date.parse('2026-11-01T06:30:00Z'));
  });

  it('ends a date UNTIL on that local date across DST', () => {
    const event: RecurringEvent = {
      start: { dateTime: '2026-03-06T10:00:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-03-06T11:00:00-05:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=DAILY;UNTIL=20260309'],
    };
    expect(starts(event).at(-1)).toBe('2026-03-09T10:00:00-04:00');
  });

  it('finds instances of long COUNT series far from their start', () => {
    const event = timed(['RRULE:FREQ=DAILY;COUNT=20000'], '2000-01-03T10:00:00+05:30');
    const instances = instancesBetween(
      event,
      'UTC',
      Date.parse('2039-01-01T00:00:00Z'),
      Date.parse('2039-01-08T00:00:00Z'),
    );
    expect(instances).toHaveLength(7);
  });

  it('only returns instances starting in the window', () => {
    const event = timed(['RRULE:FREQ=DAILY'], '2000-01-03T10:00:00+05:30');
    const instances = instancesBetween(
      event,
      'UTC',
      Date.parse('2039-01-01T00:00:00Z'),
      Date.parse('2039-01-03T00:00:00Z'),
    );
    expect(instances.map(({ start }) => start)).toEqual([
      { dateTime: '2039-01-01T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
      { dateTime: '2039-01-02T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
    ]);
  });
});

describe('assertSupportedRecurrence', () => {
  it.each(['RDATE:20261110T100000Z', 'EXRULE:FREQ=DAILY'])('does not support %s', (line) => {
    expect(() => assertSupportedRecurrence(timed(['RRULE:FREQ=DAILY', line]))).toThrow(
      UnsupportedFunctionalityError,
    );
  });

  it.each([
    'RRULE:FREQ=WEEKLY;BYDAY=1MO',
    'RRULE:FREQ=DAILY;BYHOUR=99',
    'RRULE:FREQ=YEARLY;BYYEARDAY=0',
  ])('rejects the invalid rule %s', (line) => {
    expect(() => assertSupportedRecurrence(timed([line]))).toThrow(InvalidArgumentError);
  });

  it('accepts other RFC 5545 parts and refuses unknown ones', () => {
    expect(() =>
      assertSupportedRecurrence(timed(['RRULE:FREQ=DAILY;BYHOUR=9,17;BYMINUTE=30'])),
    ).not.toThrow();
    expect(() => assertSupportedRecurrence(timed(['RRULE:FREQ=DAILY;BOGUS=YES']))).toThrow(
      UnsupportedFunctionalityError,
    );
  });

  it('refuses time parts on all-day rules and leap seconds', () => {
    const allDay = {
      start: { date: '2026-01-01' },
      end: { date: '2026-01-02' },
      recurrence: ['RRULE:FREQ=DAILY;BYHOUR=9,17;COUNT=3'],
    };
    expect(() => assertSupportedRecurrence(allDay)).toThrow(InvalidArgumentError);
    expect(() =>
      assertSupportedRecurrence(timed(['RRULE:FREQ=DAILY;BYSECOND=60;COUNT=3'])),
    ).toThrow(UnsupportedFunctionalityError);
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
