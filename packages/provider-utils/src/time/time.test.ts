import { describe, expect, it } from 'vitest';
import { addDaysToDate, eventTimeToInstant } from './event-time';
import { windowsToIanaZones } from './windows-zones';
import {
  formatZonedDateTime,
  getTimeZoneOffset,
  ianaToWindows,
  isValidTimeZone,
  localToInstant,
  parseLocalDateTime,
  windowsToIana,
} from './zoned-time';

const local = (value: string) => {
  const parsed = parseLocalDateTime(value);
  if (!parsed) throw new Error(value);
  return parsed;
};

describe('windows <-> IANA', () => {
  it('maps both directions with current IANA ids', () => {
    expect(windowsToIana('India Standard Time')).toBe('Asia/Kolkata');
    expect(windowsToIana('Pacific Standard Time')).toBe('America/Los_Angeles');
    expect(ianaToWindows('Asia/Kolkata')).toBe('India Standard Time');
    expect(ianaToWindows('Asia/Calcutta')).toBe('India Standard Time');
    expect(ianaToWindows('Europe/Berlin')).toBe('W. Europe Standard Time');
    expect(windowsToIana('Not A Zone')).toBeUndefined();
  });

  it('maps every alias of a zone and ignores inherited or empty keys', () => {
    expect(ianaToWindows('UTC')).toBe('UTC');
    expect(ianaToWindows('US/Eastern')).toBe('Eastern Standard Time');
    expect(ianaToWindows('')).toBeUndefined();
    expect(ianaToWindows('constructor')).toBeUndefined();
    expect(windowsToIana('toString')).toBeUndefined();
  });

  it('only maps to zones the runtime knows', () => {
    // Guards the generated table against ids that Intl rejects.
    const unknown = Object.values(windowsToIanaZones).filter((zone) => !isValidTimeZone(zone));
    expect(unknown).toEqual([]);
    expect(isValidTimeZone('India Standard Time')).toBe(false);
  });
});

describe('zoned time', () => {
  it('computes offsets across DST', () => {
    expect(getTimeZoneOffset(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(
      -5 * 3_600_000,
    );
    expect(getTimeZoneOffset(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(
      -4 * 3_600_000,
    );
    expect(getTimeZoneOffset(Date.parse('2026-07-15T12:00:00Z'), 'Asia/Kolkata')).toBe(19_800_000);
  });

  it('keeps milliseconds and years before 100', () => {
    expect(localToInstant(local('2026-11-03T10:00:00.250'), 'UTC')).toBe(
      Date.parse('2026-11-03T10:00:00.250Z'),
    );
    expect(formatZonedDateTime(Date.parse('2026-11-03T04:30:00.250Z'), 'Asia/Kolkata')).toBe(
      '2026-11-03T10:00:00.250+05:30',
    );
    expect(localToInstant(local('0050-06-01T00:00'), 'UTC')).toBe(
      Date.parse('0050-06-01T00:00:00Z'),
    );
  });

  it('writes UTC when the historical offset has seconds', () => {
    // Before 1854, Kolkata used local mean time, +05:53:28.
    expect(formatZonedDateTime(Date.parse('1850-01-01T00:00:00Z'), 'Asia/Kolkata')).toBe(
      '1850-01-01T00:00:00+00:00',
    );
  });

  it('resolves wall-clock times to instants', () => {
    expect(localToInstant(local('2026-11-03T10:00:00'), 'Asia/Kolkata')).toBe(
      Date.parse('2026-11-03T04:30:00Z'),
    );
  });

  it('moves times in a DST gap forward', () => {
    // 2026-03-08 02:30 does not exist in New York, clocks jump 02:00 -> 03:00.
    expect(
      formatZonedDateTime(
        localToInstant(local('2026-03-08T02:30'), 'America/New_York'),
        'America/New_York',
      ),
    ).toBe('2026-03-08T03:30:00-04:00');
  });

  it('picks the earlier instant for repeated times', () => {
    // 2026-11-01 01:30 happens twice in New York.
    expect(localToInstant(local('2026-11-01T01:30'), 'America/New_York')).toBe(
      Date.parse('2026-11-01T05:30:00Z'),
    );
  });

  it('formats instants with the zone offset', () => {
    const instant = Date.parse('2026-11-03T04:30:00Z');
    expect(formatZonedDateTime(instant, 'Asia/Kolkata')).toBe('2026-11-03T10:00:00+05:30');
    expect(formatZonedDateTime(instant, 'UTC')).toBe('2026-11-03T04:30:00+00:00');
    expect(formatZonedDateTime(instant, 'America/St_Johns')).toBe('2026-11-03T01:00:00-03:30');
  });
});

describe('event time', () => {
  it('resolves timed and all-day times', () => {
    expect(
      eventTimeToInstant({ dateTime: '2026-11-03T10:00:00+05:30', timeZone: 'Asia/Kolkata' }),
    ).toBe(Date.parse('2026-11-03T04:30:00Z'));
    expect(eventTimeToInstant({ date: '2026-11-03' }, 'Asia/Kolkata')).toBe(
      Date.parse('2026-11-02T18:30:00Z'),
    );
    expect(eventTimeToInstant({ date: '2026-11-03' })).toBe(Date.parse('2026-11-03T00:00:00Z'));
  });

  it('adds days across month and year ends', () => {
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDate('2028-03-01', -1)).toBe('2028-02-29');
  });
});
