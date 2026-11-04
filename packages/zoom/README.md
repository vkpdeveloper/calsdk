# @calsdk/zoom

Zoom provider for calsdk. Scheduled Zoom meetings are the events. Uses `fetch` only, so it runs on Node, Bun, Deno and edge runtimes.

```ts
import { zoom } from '@calsdk/zoom';
import { createEvent, listEvents } from 'calsdk';

const calendar = zoom({ accessToken: process.env.ZOOM_TOKEN });

const { events } = await listEvents({ calendar, timeMin: '2026-11-01', timeMax: '2026-12-01' });

await createEvent({
  calendar,
  event: {
    title: 'Planning',
    start: { dateTime: '2026-11-03T10:00:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-03T10:45:00', timeZone: 'Europe/Berlin' },
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=6'],
  },
});
```

`accessToken` is a Zoom OAuth access token with the scopes `meeting:read` and `meeting:write` (granular scopes: `meeting:read:meeting`, `meeting:read:list_meetings`, `meeting:write:meeting`, `meeting:update:meeting`, `meeting:delete:meeting` and `user:read:user`). Settings also take `headers` and `fetch`.

For your own account, a Server-to-Server OAuth app mints tokens that last an hour. Pass a function, and calsdk asks for a token per request:

```ts
let cached: { token: string; expires: number } | undefined;

const calendar = zoom({
  accessToken: async () => {
    if (cached && cached.expires > Date.now()) return cached.token;
    const response = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`)}` },
      },
    );
    const { access_token, expires_in } = await response.json();
    cached = { token: access_token, expires: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  },
});
```

## Behavior

- **Calendars.** `'primary'` holds the meetings the user hosts. Its time zone is the user's Zoom time zone.
- **Ids.** An event id is the meeting id. An occurrence of a series is `<meeting id>_<original start in UTC>`, such as `84512345678_20261103T090000Z`. `providerMetadata.zoom` holds the meeting's `uuid` and, for occurrences, Zoom's `occurrenceId`.
- **Times** are shown in the time zone the meeting was scheduled in.
- **Meetings** last whole minutes, up to 24 hours. Every meeting has its Zoom link in `conference`.
- **Attendees.** Attendees are Zoom's meeting invitees, by email address only. `getEvent` returns them with the host as `organizer`. Listing and sync leave `attendees` and `organizer` out, as Zoom does not list them.
- **Recurring meetings.** Zoom repeats meetings daily (every 1 to 99 days), weekly on set weekdays (every 1 to 50 weeks), or monthly on a day of the month or an nth weekday (every 1 to 10 months), for up to 60 meetings or until a date. Other rules throw `UnsupportedFunctionalityError`, as do rules whose days leave out the first meeting. Zoom's weeks start on Monday, so a rule repeating every few weeks on several days with another `WKST` throws too. Zoom keeps no list of excluded dates: delete occurrences one by one instead of passing `EXDATE` lines.
- **Series far ahead.** Zoom schedules no meetings for a series that starts years ahead. Creating one, or moving a meeting or series that far, throws `UnsupportedFunctionalityError`, and calsdk deletes what Zoom created or undoes the change. Ones made elsewhere are left out until Zoom schedules them, but can be deleted by id.
- **Changing one occurrence** can only move or resize it. Other changes need `scope: 'all'`, which changes the whole series. Moving an occurrence with `scope: 'all'` moves the series by as much.
- **Moving a series** makes Zoom schedule every meeting of it again: occurrences deleted, moved or resized on their own come back as they were, with ids for their new starts. The update returns a warning when that happens. Other changes to a series keep them.
- **Not supported:** all-day events, `thisAndFollowing`, `ifMatch` and search, which throw `UnsupportedFunctionalityError`. `location`, `visibility`, `reminders` and `color` are ignored with a warning.
- **`sendUpdates`.** Zoom does not email invitees about changes made through its API, so values other than `'none'` return a warning.
- **Listing** reads every scheduled meeting and filters them, since Zoom cannot list meetings by time. Zoom cuts agendas in listings to 250 characters, and stops listing meetings some time after they end. Each series takes a request of its own, made one at a time to stay under Zoom's rate limits.
- **Free/busy** is computed by calsdk from meetings.
- **Sync.** Zoom cannot list meetings by when they changed, so each sync reads every meeting and compares it with the last sync. All changes come on one page. Meetings Zoom stops listing after they end are not reported as deleted.
