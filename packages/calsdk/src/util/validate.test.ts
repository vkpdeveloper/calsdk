import { InvalidArgumentError } from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import {
  normalizeEventTime,
  toTimeRange,
  validateEventInput,
  validateEventPatch,
} from './validate';

const argumentOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (InvalidArgumentError.isInstance(error)) return error.argument;
    throw error;
  }
  throw new Error('did not throw');
};

describe('normalizeEventTime', () => {
  it('adds the zone offset to wall-clock times', () => {
    expect(
      normalizeEventTime({ dateTime: '2026-11-03T10:00:00', timeZone: 'Asia/Kolkata' }, 'start'),
    ).toEqual({
      dateTime: '2026-11-03T10:00:00+05:30',
      timeZone: 'Asia/Kolkata',
    });
  });

  it('keeps fractional seconds', () => {
    expect(
      normalizeEventTime({ dateTime: '2026-11-03T10:00:00.900', timeZone: 'UTC' }, 'start'),
    ).toEqual({ dateTime: '2026-11-03T10:00:00.900+00:00', timeZone: 'UTC' });
  });

  it('keeps explicit offsets and all-day dates', () => {
    const timed = { dateTime: '2026-11-03T04:30:00Z', timeZone: 'Asia/Kolkata' };
    expect(normalizeEventTime(timed, 'start')).toEqual(timed);
    expect(normalizeEventTime({ date: '2026-11-03' }, 'start')).toEqual({ date: '2026-11-03' });
  });

  it('suggests the IANA name for Windows zones', () => {
    expect(() =>
      normalizeEventTime(
        { dateTime: '2026-11-03T10:00:00', timeZone: 'India Standard Time' },
        'start',
      ),
    ).toThrow(/Use the IANA name "Asia\/Kolkata"/);
  });

  it.each([
    [{ date: '2026-02-30' }, 'start.date'],
    [{ date: '2026-11-03', dateTime: '2026-11-03T10:00:00Z', timeZone: 'UTC' }, 'start'],
    [{ dateTime: 'tomorrow', timeZone: 'UTC' }, 'start.dateTime'],
    [{ dateTime: '2026-11-03T25:00:00', timeZone: 'UTC' }, 'start.dateTime'],
    [{ dateTime: '2026-11-03T10:99:00', timeZone: 'UTC' }, 'start.dateTime'],
    [{ dateTime: '2026-02-30T10:00:00Z', timeZone: 'UTC' }, 'start.dateTime'],
    [{ dateTime: '2026-11-03T10:00:00+24:00', timeZone: 'UTC' }, 'start.dateTime'],
    [{ dateTime: '2026-11-03', timeZone: 'UTC' }, 'start.dateTime'],
    [{ dateTime: '2026-11-03T10:00:00Z' }, 'start.timeZone'],
  ])('rejects %j', (time, argument) => {
    expect(argumentOf(() => normalizeEventTime(time, 'start'))).toBe(argument);
  });
});

describe('validateEventInput', () => {
  const start = { dateTime: '2026-11-03T10:00:00Z', timeZone: 'UTC' };

  it('requires end after start of the same kind', () => {
    expect(argumentOf(() => validateEventInput({ start, end: start }))).toBe('event.end');
    expect(argumentOf(() => validateEventInput({ start, end: { date: '2026-11-04' } }))).toBe(
      'event.end',
    );
    expect(
      argumentOf(() =>
        validateEventInput({ start: { date: '2026-11-03' }, end: { date: '2026-11-03' } }),
      ),
    ).toBe('event.end');
  });

  it('rejects malformed fields before calling the provider', () => {
    const end = { dateTime: '2026-11-03T11:00:00Z', timeZone: 'UTC' };
    expect(argumentOf(() => validateEventInput({ start, end, color: 'blue' }))).toBe('event.color');
    expect(
      argumentOf(() => validateEventInput({ start, end, attendees: [{ email: 'nope' }] })),
    ).toBe('event.attendees[0].email');
    expect(
      argumentOf(() =>
        validateEventInput({ start, end, recurrence: ['RRULE:FREQ=DAILY\r\nATTENDEE:x'] }),
      ),
    ).toBe('event.recurrence');
    expect(
      argumentOf(() => validateEventInput({ start, end, recurrence: ['RRULE:FREQ=SOMETIMES'] })),
    ).toBe('recurrence');
  });
});

describe('validateEventPatch', () => {
  it('rejects clearing start or end', () => {
    expect(argumentOf(() => validateEventPatch({ start: null } as never))).toBe('patch.start');
  });

  it('allows clearing other fields', () => {
    expect(validateEventPatch({ location: null, color: null })).toEqual({
      location: null,
      color: null,
    });
  });
});

describe('toTimeRange', () => {
  it('converts dates and rejects empty windows', () => {
    expect(toTimeRange(new Date('2026-11-01T00:00:00Z'), '2026-11-02')).toEqual({
      timeMin: '2026-11-01T00:00:00.000Z',
      timeMax: '2026-11-02T00:00:00.000Z',
    });
    expect(argumentOf(() => toTimeRange('2026-11-02', '2026-11-01'))).toBe('timeMax');
    expect(argumentOf(() => toTimeRange('soon', '2026-11-01'))).toBe('timeMin');
  });
});
