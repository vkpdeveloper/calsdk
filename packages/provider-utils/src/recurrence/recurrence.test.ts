import { InvalidArgumentError } from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import {
  formatExdates,
  formatRRule,
  instantToICalDate,
  parseICalDate,
  parseRecurrence,
  parseRRule,
} from './recurrence';

describe('parseRRule', () => {
  it('parses the modeled parts', () => {
    expect(
      parseRRule(
        'RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR,2MO;BYMONTH=1,6;WKST=SU;UNTIL=20261231T235959Z',
      ),
    ).toEqual({
      freq: 'MONTHLY',
      interval: 2,
      byDay: [
        { weekday: 'FR', n: -1 },
        { weekday: 'MO', n: 2 },
      ],
      byMonth: [1, 6],
      weekStart: 'SU',
      until: { type: 'date-time', local: '2026-12-31T23:59:59', timeZone: 'UTC' },
    });
  });

  it('keeps unmodeled parts verbatim so they round-trip', () => {
    const line = 'RRULE:FREQ=DAILY;COUNT=5;BYHOUR=9,17';
    const rule = parseRRule(line);
    expect(rule.other).toEqual({ BYHOUR: '9,17' });
    expect(formatRRule(rule)).toBe(line);
  });

  it.each([
    'FREQ=FORTNIGHTLY',
    'INTERVAL=2',
    'FREQ=DAILY;COUNT=0',
    'FREQ=DAILY;COUNT=3;UNTIL=20261231',
    'FREQ=WEEKLY;BYDAY=XX',
    'FREQ=WEEKLY;BYDAY=0MO',
    'FREQ=MONTHLY;BYMONTHDAY=32',
    'FREQ=DAILY;UNTIL=20261340',
    'FREQ',
  ])('rejects %s', (line) => {
    expect(() => parseRRule(line)).toThrow(InvalidArgumentError);
  });
});

describe('formatRRule', () => {
  it('round-trips through parseRRule', () => {
    for (const line of [
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'RRULE:FREQ=MONTHLY;INTERVAL=3;BYDAY=-1SU',
      'RRULE:FREQ=YEARLY;UNTIL=20301231;BYMONTHDAY=29;BYMONTH=2',
      'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    ]) {
      expect(formatRRule(parseRRule(line))).toBe(line);
    }
  });
});

describe('parseRecurrence', () => {
  it('splits rule, exception dates and other lines', () => {
    const parsed = parseRecurrence([
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'EXDATE;TZID=Asia/Kolkata:20261110T100000,20261117T100000',
      'EXDATE:20261124T043000Z',
      'EXDATE;VALUE=DATE:20261201',
      'EXRULE:FREQ=MONTHLY',
    ]);
    expect(parsed.rrule?.freq).toBe('WEEKLY');
    expect(parsed.exdates).toEqual([
      { type: 'date-time', local: '2026-11-10T10:00:00', timeZone: 'Asia/Kolkata' },
      { type: 'date-time', local: '2026-11-17T10:00:00', timeZone: 'Asia/Kolkata' },
      { type: 'date-time', local: '2026-11-24T04:30:00', timeZone: 'UTC' },
      { type: 'date', date: '2026-12-01' },
    ]);
    expect(parsed.other).toEqual(['EXRULE:FREQ=MONTHLY']);
  });

  it('rejects more than one RRULE', () => {
    expect(() => parseRecurrence(['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY'])).toThrow(
      InvalidArgumentError,
    );
  });
});

describe('formatExdates', () => {
  it('groups values by zone and type', () => {
    expect(
      formatExdates([
        parseICalDate('20261110T100000', 'Asia/Kolkata'),
        parseICalDate('20261117T100000', 'Asia/Kolkata'),
        parseICalDate('20261124T043000Z'),
        parseICalDate('20261201'),
      ]),
    ).toEqual([
      'EXDATE;TZID=Asia/Kolkata:20261110T100000,20261117T100000',
      'EXDATE:20261124T043000Z',
      'EXDATE;VALUE=DATE:20261201',
    ]);
  });

  it('formats instants as UTC date-times', () => {
    expect(formatExdates([instantToICalDate(Date.parse('2026-11-24T04:30:00Z'))])).toEqual([
      'EXDATE:20261124T043000Z',
    ]);
  });
});

describe('validation', () => {
  it.each([
    ['a line break', 'RRULE:FREQ=DAILY\r\nATTENDEE:mailto:x@example.com'],
    ['a repeated part', 'RRULE:FREQ=DAILY;FREQ=WEEKLY'],
    ['a part with two values', 'RRULE:FREQ=DAILY;BYHOUR=9=17'],
    ['a COUNT that is not a safe integer', `RRULE:FREQ=DAILY;COUNT=${'9'.repeat(400)}`],
    ['numbered BYDAY with WEEKLY', 'RRULE:FREQ=WEEKLY;BYDAY=2MO'],
    ['BYMONTHDAY with WEEKLY', 'RRULE:FREQ=WEEKLY;BYMONTHDAY=3'],
    ['an impossible date', 'EXDATE;VALUE=DATE:20260230'],
  ])('rejects %s', (_, line) => {
    expect(() => parseRecurrence([line])).toThrow(InvalidArgumentError);
  });

  it('unquotes TZID and keeps RDATE periods verbatim', () => {
    const lines = [
      'EXDATE;TZID="Asia/Kolkata":20261110T100000',
      'RDATE;VALUE=PERIOD:20261110T100000Z/PT1H',
    ];
    expect(parseRecurrence(lines)).toEqual({
      exdates: [{ type: 'date-time', local: '2026-11-10T10:00:00', timeZone: 'Asia/Kolkata' }],
      rdates: [],
      other: ['RDATE;VALUE=PERIOD:20261110T100000Z/PT1H'],
    });
  });

  it('refuses to format values that would break the line', () => {
    expect(() =>
      formatExdates([{ type: 'date-time', local: '2026-11-10T10:00:00', timeZone: 'X:\r\nY' }]),
    ).toThrow(InvalidArgumentError);
    expect(() => formatExdates([{ type: 'date', date: '2026-11-10\r\nX' }])).toThrow(
      InvalidArgumentError,
    );
    expect(() => formatRRule({ freq: 'DAILY', other: { BYHOUR: '9;COUNT=1' } })).toThrow(
      InvalidArgumentError,
    );
  });
});
