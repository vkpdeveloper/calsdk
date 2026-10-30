import { mockCalendar } from '@calsdk/mock';
import {
  createEvent,
  deleteEvent,
  findFreeTime,
  getEvent,
  listCalendars,
  listEvents,
  NotFoundError,
  syncEvents,
  updateEvent,
} from 'calsdk';

// An in-memory calendar, so this runs offline. Swap in a real provider with one line:
//   import { google } from '@calsdk/google';
//   const calendar = google({ accessToken: process.env.GOOGLE_ACCESS_TOKEN ?? '' });
// or `microsoft({ accessToken })` from '@calsdk/microsoft'. Everything below stays the same.
const calendar = mockCalendar({
  calendars: [{ id: 'work', name: 'Work', timeZone: 'Europe/Berlin' }],
  events: [
    {
      title: 'Design review',
      start: { dateTime: '2026-11-03T14:00:00+01:00', timeZone: 'Europe/Berlin' },
      end: { dateTime: '2026-11-03T15:30:00+01:00', timeZone: 'Europe/Berlin' },
    },
  ],
});
const week = { timeMin: '2026-11-02T00:00:00+01:00', timeMax: '2026-11-07T00:00:00+01:00' };

const { calendars } = await listCalendars({ calendar });
console.log('Calendars:', calendars.map((item) => `${item.name} (${item.id})`).join(', '));

// 'primary' is the default calendar id on every provider.
const { event: standup } = await createEvent({
  calendar,
  event: {
    title: 'Standup',
    start: { dateTime: '2026-11-02T09:30:00+01:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-02T09:45:00+01:00', timeZone: 'Europe/Berlin' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  },
});
console.log(`Created ${standup.kind} "${standup.title}" (${standup.recurrence?.join(' ')})`);

const { events } = await listEvents({ calendar, ...week, expandRecurring: true });
console.log('This week:');
for (const event of events)
  console.log(`  ${event.start.dateTime}  ${event.title} [${event.kind}]`);

// Changing one occurrence turns it into an exception; the rest of the series is untouched.
const wednesday = events.find((event) => event.start.dateTime?.startsWith('2026-11-04'));
if (wednesday) {
  const { event } = await updateEvent({
    calendar,
    eventId: wednesday.id,
    patch: {
      start: { dateTime: '2026-11-04T10:00:00+01:00', timeZone: 'Europe/Berlin' },
      end: { dateTime: '2026-11-04T10:15:00+01:00', timeZone: 'Europe/Berlin' },
    },
  });
  console.log(`Moved Wednesday's standup to ${event.start.dateTime} [${event.kind}]`);
}

const { slots } = await findFreeTime({
  calendars: [{ calendar }],
  ...week,
  duration: 60,
  slotInterval: 30,
  workingHours: { start: '09:00', end: '17:00', timeZone: 'Europe/Berlin', days: [2] },
});
const berlinTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
});
console.log(
  'Free hours on Tuesday (Berlin):',
  slots.map((slot) => berlinTime.format(new Date(slot.start))).join(', '),
);

// Sync: store the cursor, then fetch only what changed since.
const initial = await syncEvents({ calendar });
await createEvent({
  calendar,
  event: {
    title: 'Lunch',
    start: { dateTime: '2026-11-05T12:00:00+01:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-05T13:00:00+01:00', timeZone: 'Europe/Berlin' },
  },
});
const { changes } = await syncEvents({ calendar, cursor: initial.nextCursor });
console.log(
  'Changed since the last sync:',
  changes.map((change) => (change.type === 'upsert' ? change.event.title : change.eventId)),
);

await deleteEvent({ calendar, eventId: standup.id });
try {
  await getEvent({ calendar, eventId: standup.id });
} catch (error) {
  if (!NotFoundError.isInstance(error)) throw error;
  console.log('The standup series is gone:', error.message);
}
