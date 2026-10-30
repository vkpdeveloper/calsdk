# @calsdk/calendly

Calendly provider for calsdk. Scheduled meetings are the events. Uses `fetch` only, so it runs on Node, Bun, Deno and edge runtimes.

```ts
import { calendly } from '@calsdk/calendly';
import { createEvent, listEvents } from 'calsdk';

const calendar = calendly({ accessToken: process.env.CALENDLY_TOKEN });

const { events } = await listEvents({ calendar, timeMin: '2026-11-01', timeMax: '2026-12-01' });

// Book a 30 minute event type for a guest.
await createEvent({
  calendar,
  event: {
    start: { dateTime: '2026-11-03T10:00:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-03T10:30:00', timeZone: 'Europe/Berlin' },
    attendees: [{ email: 'guest@example.com', name: 'Guest' }],
  },
  providerOptions: {
    calendly: { eventType: 'https://api.calendly.com/event_types/<uuid>' },
  },
});
```

`accessToken` is a Calendly personal access token or OAuth access token with the scopes `users:read`, `scheduled_events:read`, and `event_types:read` and `scheduled_events:write` to book. Settings also take `headers` and `fetch`.

## Behavior

- **Calendars.** `'primary'` holds every meeting the user hosts. Calendly cannot list meetings by event type, so there are no other calendars.
- **Ids.** An event id is the scheduled event's uuid. `providerMetadata.calendly` holds its `uri` and the URI of its `eventType`.
- **Times** are shown in the user's Calendly time zone.
- **Attendees.** `getEvent` and `createEvent` return the hosts, the invitees and the guests they added. Listing and sync leave `attendees` out, as Calendly needs a request per meeting for its invitees. Hosts are in `organizer`.
- **Creating** books an event type through Calendly's Scheduling API, which needs a paid plan. Pass the event type in `providerOptions.calendly.eventType`. The meeting lasts as long as the event type, and other lengths throw `InvalidArgumentError`. Calendly only books times the event type has free. The first attendee books the meeting and the others are added as guests (up to 10). Without attendees, the user books it for themselves. Fields the event type sets (`title`, `description`, `location`, `createConference`, `reminders`, `color`, `visibility`) are ignored with a warning. To pick one of the event type's locations, pass `providerOptions.calendly.location`.
- **Updating** is not supported: Calendly cannot change a scheduled meeting. Delete it and create a new one.
- **Deleting** cancels the meeting. Cancelled meetings are deleted events.
- **Not supported:** all-day and recurring events, `ifMatch` and search, which throw `UnsupportedFunctionalityError`.
- **Listing** finds meetings by their start, looking back a day for meetings that end in the window (Calendly meetings last at most 12 hours).
- **`sendUpdates`.** Calendly always emails invitees, so values other than `'all'` return a warning.
- **Free/busy** is computed by calsdk from meetings.
- **Sync.** Calendly cannot list meetings by when they changed, so each sync reads every active meeting and compares it with the last sync. All changes come on one page. The cursor grows with the number of meetings.

## Provider options

```ts
await createEvent({
  calendar,
  event,
  providerOptions: {
    calendly: { eventType: '<uuid>', location: { kind: 'physical', location: 'Office' } },
  },
});

await deleteEvent({
  calendar,
  eventId,
  providerOptions: { calendly: { reason: 'No longer needed' } },
});
```
