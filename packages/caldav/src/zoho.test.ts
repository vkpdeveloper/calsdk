import { fileURLToPath } from 'node:url';
import { NotFoundError } from '@cal-sdk/provider';
import { createRecordingFetch } from '@cal-sdk/provider-tests';
import { afterAll, expect, it } from 'vitest';
import { pinWrites } from '../test/pin-writes';
import { zoho } from './caldav-provider';

// Recorded against a Zoho Calendar account with a calendar named `calsdk test`, checked for
// CalDAV sync in Zoho Calendar's settings. To re-record, run with CALSDK_RECORD=1 and
// ZOHO_EMAIL and ZOHO_PASSWORD (an app-specific password) set, then replace the account's
// address and ids in the recording. Zoho ignores writes of a UID it deleted before, and
// pinWrites derives UIDs from the test's name, so rename the test before recording again.
const recording = createRecordingFetch({
  path: fileURLToPath(new URL('../test/fixtures/zoho.json', import.meta.url)),
  mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
});
afterAll(() => recording.save());
pinWrites();

const provider = zoho({
  email: process.env.ZOHO_EMAIL ?? 'me@example.com',
  password: process.env.ZOHO_PASSWORD ?? 'replay',
  fetch: recording.fetch,
});

it('creates, lists, updates and deletes an event in a Zoho calendar', async () => {
  const { calendars } = await provider.doListCalendars({});
  expect(calendars.filter((calendar) => calendar.isPrimary)).toHaveLength(1);
  const calendarId = calendars.find((calendar) => calendar.name === 'calsdk test')?.id;
  if (!calendarId) throw new Error('Expected the calendar "calsdk test".');

  const start = { dateTime: '2030-03-04T10:00:00Z', timeZone: 'UTC' };
  const end = { dateTime: '2030-03-04T11:00:00Z', timeZone: 'UTC' };
  const { event } = await provider.doCreateEvent({
    calendarId,
    event: { title: 'calsdk zoho', start, end },
  });
  try {
    expect(event).toMatchObject({ calendarId, title: 'calsdk zoho', kind: 'single' });
    expect(Date.parse(event.start.dateTime ?? '')).toBe(Date.parse(start.dateTime));
    expect((await provider.doGetEvent({ calendarId, eventId: event.id })).event.title).toBe(
      'calsdk zoho',
    );
    const { events } = await provider.doListEvents({
      calendarId,
      timeMin: '2030-03-04T00:00:00Z',
      timeMax: '2030-03-05T00:00:00Z',
      expandRecurring: true,
    });
    expect(events.map((listed) => listed.id)).toEqual([event.id]);

    const updated = await provider.doUpdateEvent({
      calendarId,
      eventId: event.id,
      patch: { title: 'calsdk zoho (renamed)' },
    });
    expect(updated.event.title).toBe('calsdk zoho (renamed)');
  } finally {
    await provider.doDeleteEvent({ calendarId, eventId: event.id });
  }
  await expect(provider.doGetEvent({ calendarId, eventId: event.id })).rejects.toThrow(
    NotFoundError,
  );
}, 60_000);
