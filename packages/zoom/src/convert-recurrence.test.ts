import { UnsupportedFunctionalityError } from '@cal-sdk/provider';
import { describe, expect, it } from 'vitest';
import { fromZoomRecurrence, toZoomRecurrence } from './convert-recurrence';

const ZONE = 'America/New_York';
// Monday 7 January 2030, 10:00 in New York.
const MONDAY = Date.parse('2030-01-07T15:00:00Z');
const convert = (rule: string, start = MONDAY, deleted?: number[]) =>
  toZoomRecurrence(rule.split('\n'), { start, timeZone: ZONE, deleted });

describe('toZoomRecurrence', () => {
  it('converts the rules Zoom can store', () => {
    expect(convert('RRULE:FREQ=DAILY;COUNT=5')).toEqual({
      type: 1,
      repeat_interval: 1,
      end_times: 5,
    });
    expect(convert('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO')).toEqual({
      type: 2,
      repeat_interval: 2,
      end_times: 0,
      weekly_days: '2,4',
    });
    expect(convert('RRULE:FREQ=WEEKLY;COUNT=3')).toMatchObject({ type: 2, weekly_days: '2' });
    expect(convert('RRULE:FREQ=MONTHLY;BYMONTHDAY=7;COUNT=3')).toMatchObject({
      type: 3,
      monthly_day: 7,
    });
    expect(convert('RRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=3')).toMatchObject({
      type: 3,
      monthly_week: 1,
      monthly_week_day: 2,
    });
    expect(
      convert('RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1', Date.parse('2030-01-28T15:00:00Z')),
    ).toMatchObject({ type: 3, monthly_week: -1, monthly_week_day: 2 });
  });

  it('ends a date-only UNTIL at the end of that day in the series zone', () => {
    expect(convert('RRULE:FREQ=DAILY;UNTIL=20300110')).toEqual({
      type: 1,
      repeat_interval: 1,
      end_date_time: '2030-01-11T04:59:59Z',
    });
  });

  it('rejects rules Zoom would store differently', () => {
    for (const rule of [
      'RRULE:FREQ=YEARLY',
      'RRULE:FREQ=DAILY;COUNT=61',
      'RRULE:FREQ=DAILY;INTERVAL=100',
      'RRULE:FREQ=DAILY;BYDAY=MO',
      // The first meeting is a Monday.
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=8',
      'RRULE:FREQ=MONTHLY;BYDAY=2MO',
      'RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1',
      'RRULE:FREQ=MONTHLY;BYDAY=5MO',
      'RRULE:FREQ=DAILY\nRDATE:20300120T150000Z',
      'RRULE:FREQ=DAILY;COUNT=5\nEXDATE:20300108T150000Z',
      'EXRULE:FREQ=DAILY',
    ]) {
      expect(() => convert(rule), rule).toThrow(UnsupportedFunctionalityError);
    }
  });

  it('keeps the Monday week start Zoom uses for rules repeating every few weeks', () => {
    // Every other week on Monday and Sunday: Zoom pairs each Monday with the Sunday after it.
    for (const rule of [
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU',
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=MO',
      // One day a week picks the same days whatever the week start.
      'RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU',
    ]) {
      expect(convert(rule), rule).toMatchObject({ type: 2, repeat_interval: 2 });
    }
    expect(() => convert('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=SU')).toThrow(
      UnsupportedFunctionalityError,
    );
  });

  it('accepts EXDATEs only for meetings already deleted', () => {
    const deleted = Date.parse('2030-01-08T15:00:00Z');
    expect(
      convert('RRULE:FREQ=DAILY;COUNT=5\nEXDATE:20300108T150000Z', MONDAY, [deleted]),
    ).toMatchObject({ type: 1, end_times: 5 });
  });
});

describe('fromZoomRecurrence', () => {
  it('reads Zoom patterns back as the rules they came from', () => {
    expect(fromZoomRecurrence({ type: 2, repeat_interval: 2, weekly_days: '2,4' }, [])).toEqual([
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    ]);
    expect(
      fromZoomRecurrence({ type: 3, monthly_week: -1, monthly_week_day: 2, end_times: 3 }, [
        Date.parse('2030-02-25T15:00:00Z'),
      ]),
    ).toEqual(['RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=-1MO', 'EXDATE:20300225T150000Z']);
    expect(fromZoomRecurrence({ type: 1, end_date_time: '2030-01-11T04:59:59Z' }, [])).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20300111T045959Z',
    ]);
    expect(fromZoomRecurrence({ type: 2, weekly_days: '9' }, [])).toBeUndefined();
  });
});
