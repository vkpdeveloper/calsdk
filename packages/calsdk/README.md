# calsdk

One TypeScript API for Google Calendar, Microsoft Outlook, iCloud and other CalDAV servers, Cal.com, ICS feeds and any other calendar provider. Pick a provider, then call plain functions.

```ts
import { createEvent, findFreeTime, listEvents } from 'calsdk';
import { mockCalendar } from '@calsdk/mock';

const calendar = mockCalendar(); // or google({ accessToken }), microsoft({ accessToken }), calcom({ accessToken })

await createEvent({
  calendar,
  event: {
    title: 'Design review',
    start: { dateTime: '2026-11-03T10:00:00', timeZone: 'Asia/Kolkata' },
    end: { dateTime: '2026-11-03T11:00:00', timeZone: 'Asia/Kolkata' },
  },
});

const { events } = await listEvents({ calendar, timeMin: '2026-11-01', timeMax: '2026-12-01' });

const { slots } = await findFreeTime({
  calendars: [{ calendar }],
  timeMin: new Date(),
  timeMax: new Date(Date.now() + 7 * 86_400_000),
  duration: 30,
  workingHours: { start: '09:00', end: '18:00', timeZone: 'Asia/Kolkata' },
});
```

## Functions

| Function                                                | What it does                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `listCalendars`                                         | Calendars the user can see. One is `isPrimary`.                                                                |
| `getEvent`, `createEvent`, `updateEvent`, `deleteEvent` | Single events. Updates and deletes of recurring instances take `scope: 'this' \| 'thisAndFollowing' \| 'all'`. |
| `listEvents`, `iterateEvents`                           | Events in a time window. Recurring events are expanded by default. `iterateEvents` walks every page.           |
| `getFreeBusy`                                           | Busy blocks per calendar. Falls back to reading events when the provider has no free/busy endpoint.            |
| `findFreeTime`                                          | Slots when every calendar, across providers, is free.                                                          |
| `syncEvents`                                            | Changes since a stored cursor. Follows every page unless `paginate: false`.                                    |

Every function takes `calendar`, plus optional `maxRetries` (default 2), `abortSignal`, `headers` and `providerOptions`. `calendarId` defaults to `'primary'`.

`providerOptions` and `providerMetadata` are typed by the provider passed as `calendar`:

```ts
const calendar = google({ accessToken });

// Type error: Google has no `guestsCanModfy` option.
await createEvent({ calendar, event, providerOptions: { google: { guestsCanModfy: true } } });

const { event: created } = await createEvent({ calendar, event });
created.providerMetadata?.google?.iCalUID; // string | undefined
```

## Time

Timed values are `{ dateTime, timeZone }` with an IANA zone. A `dateTime` without an offset is read as wall-clock time in `timeZone`. All-day values are `{ date: 'YYYY-MM-DD' }`, and all-day end dates are exclusive.

## Warnings and errors

When a provider cannot honor part of a request, the call still succeeds and returns `warnings`. Set `globalThis.CALSDK_WARNINGS` to `'console'` (default), `'silent'` or a function.

Errors extend `CalsdkError`. Check them with `isInstance`, which works across duplicated package copies:

```ts
import { SyncCursorExpiredError, syncEvents } from 'calsdk';

try {
  await syncEvents({ calendar, cursor });
} catch (error) {
  if (SyncCursorExpiredError.isInstance(error)) await fullResync();
  else throw error;
}
```
