import { InvalidArgumentError, type WarningV1 } from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { applyPatch, newCalendar, setScheduleAgent } from './write-event';

const times = {
  start: { dateTime: '2030-01-07T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
  end: { dateTime: '2030-01-07T11:00:00+05:30', timeZone: 'Asia/Kolkata' },
};
// Long lines are folded onto the next, which starts with a space.
const lines = (text: string, name: string) =>
  text
    .replaceAll('\r\n ', '')
    .split('\r\n')
    .filter((line) => line.startsWith(name));

describe('writing events', () => {
  it('invites attendees from the account, keeping responses already given', () => {
    const warnings: WarningV1[] = [];
    const calendar = newCalendar(
      'uid-1',
      { ...times, attendees: [{ email: 'a@example.com', name: 'A' }] },
      { organizer: 'me@example.com', warnings },
    );
    const vevent = calendar.getFirstSubcomponent('vevent');
    if (!vevent) throw new Error('Expected a VEVENT.');
    vevent.getFirstProperty('attendee')?.setParameter('partstat', 'ACCEPTED');

    applyPatch(
      vevent,
      { attendees: [{ email: 'A@example.com' }, { email: 'b@example.com', optional: true }] },
      { warnings },
    );
    setScheduleAgent(calendar, 'none', warnings);
    const text = calendar.toString();
    expect(lines(text, 'ORGANIZER')).toEqual(['ORGANIZER:mailto:me@example.com']);
    expect(lines(text, 'ATTENDEE')).toEqual([
      'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;SCHEDULE-AGENT=CLIENT:mailto:A@example.com',
      'ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;SCHEDULE-AGENT=CLIENT:mailto:b@example.com',
    ]);

    setScheduleAgent(calendar, 'all', warnings);
    expect(calendar.toString()).not.toContain('SCHEDULE-AGENT');
    expect(warnings).toEqual([]);
  });

  it('needs the account email to invite attendees', () => {
    expect(() =>
      newCalendar('uid-1', { ...times, attendees: [{ email: 'a@example.com' }] }, { warnings: [] }),
    ).toThrow(InvalidArgumentError);
  });

  it('writes times in the zone they were given in, and only recurrence lines as recurrence', () => {
    const calendar = newCalendar(
      'uid-1',
      { ...times, recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'] },
      { warnings: [] },
    );
    const text = calendar.toString();
    expect(lines(text, 'DTSTART')).toEqual(['DTSTART;TZID=Asia/Kolkata:20300107T100000']);
    expect(lines(text, 'RRULE')).toEqual(['RRULE:FREQ=WEEKLY;COUNT=2']);

    expect(() =>
      newCalendar('uid-1', { ...times, recurrence: ['SUMMARY:x'] }, { warnings: [] }),
    ).toThrow(InvalidArgumentError);
  });
});
