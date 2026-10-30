# @calsdk/calcom

Cal.com provider for calsdk. Bookings are the events. Uses `fetch` only, so it runs on Node, Bun, Deno and edge runtimes.

```ts
import { calcom } from '@calsdk/calcom';
import { createEvent, listEvents } from 'calsdk';

const calendar = calcom({ accessToken: process.env.CALCOM_API_KEY });

const { events } = await listEvents({ calendar, timeMin: '2026-11-01', timeMax: '2026-12-01' });

// Book the event type 123456 for a guest.
await createEvent({
  calendar,
  calendarId: '123456',
  event: {
    start: { dateTime: '2026-11-03T10:00:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-03T10:30:00', timeZone: 'Europe/Berlin' },
    attendees: [{ email: 'guest@example.com', name: 'Guest' }],
  },
});
```

`accessToken` is a Cal.com API key (`cal_live_...`) or an OAuth access token. Settings also take `baseURL` (`https://api.cal.eu/v2` for Cal.com EU), `headers` and `fetch`.

## Calendars

- **`'primary'`** holds every booking of the user.
- **Each event type** is a calendar whose id is the event type id, such as `'123456'`. It holds that event type's bookings.

## Behavior

- **Ids.** An event id is the booking's `uid`.
- **Creating** books an event type: the calendar's, or `providerOptions.calcom.eventTypeId` on `'primary'`. The first attendee books the slot and the others are added as guests. Without attendees, the user books it for themselves. The description becomes the booking's notes. Cal.com names bookings after their event type, so `title`, and fields the event type sets (`location`, `createConference`, `reminders`, `color`, `visibility`), are ignored with a warning.
- **Lengths.** A booking lasts as long as its event type, or one of the lengths the event type offers. Other lengths throw `InvalidArgumentError`.
- **Availability.** calsdk writes the times it is given, so bookings may overlap others and fall outside the event type's availability. Set `allowConflicts` or `allowBookingOutOfBounds` to `false` to enforce them.
- **Updating** can only move a booking. Cal.com moves a booking by replacing it, so the returned event has a new id and the old id reads as deleted. Changes to other fields are ignored with a warning, and the booking keeps the time zone it was made in.
- **Deleting** cancels the booking. Cancelled and rejected bookings are deleted events. Bookings waiting for confirmation are `tentative`.
- **Not supported:** all-day and recurring events, `ifMatch` and search, which throw `UnsupportedFunctionalityError`.
- **Listing** finds bookings by their start, looking back as far as the longest length your event types allow (at least a day). Cal.com cannot filter bookings by their end, so a booking that started before that lookback is not listed: one of a team event type you do not own, or one longer than its event type now allows.
- **`sendUpdates`.** Cal.com always emails attendees, so values other than `'all'` return a warning.
- **Free/busy** is computed by calsdk from bookings.
- **Sync** reads bookings by the time they last changed. Each sync rereads the minute before the newest change it saw, so a slow save is not missed. An initial sync returns active bookings only.

## Provider options

```ts
await createEvent({
  calendar,
  event,
  providerOptions: {
    calcom: { eventTypeId: 123456, metadata: { orderId: '42' }, allowConflicts: false },
  },
});

await updateEvent({
  calendar,
  eventId,
  patch: { start, end },
  providerOptions: { calcom: { reschedulingReason: 'Travel' } },
});

await deleteEvent({
  calendar,
  eventId,
  providerOptions: { calcom: { cancellationReason: 'No longer needed' } },
});
```

Events carry `providerMetadata.calcom` with the numeric `bookingId`, `eventTypeId`, Cal.com's `status`, `rescheduledFromUid` and your `metadata`.
