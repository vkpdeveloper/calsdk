# @calsdk/google

Google Calendar provider for calsdk. Uses `fetch` only, so it runs on Node, Bun, Deno and edge runtimes.

```ts
import { google } from '@calsdk/google';
import { listEvents } from 'calsdk';

const calendar = google({ accessToken: () => getFreshAccessToken() });

const { events } = await listEvents({ calendar, timeMin: '2026-11-01', timeMax: '2026-12-01' });
```

`accessToken` is an OAuth token with a Calendar scope, such as `https://www.googleapis.com/auth/calendar`. calsdk does not run OAuth flows: pass a function to refresh tokens yourself. Settings also take `baseURL`, `headers` and `fetch`.

## Behavior

- **Colors.** Google has 11 fixed event colors. Other hex colors are saved as the nearest one, with a `compatibility` warning. Colors are the ones the Google Calendar web app shows.
- **Modified instances.** Expanded listings do not say which instances were modified, so calsdk makes one extra request per page that contains recurring instances to tell `exception` from `occurrence`.
- **`thisAndFollowing`.** calsdk creates a new series from the chosen instance, copying attendees and the existing meeting link, then ends the old series the moment before it. A `COUNT` is split by the rule's positions, and `EXDATE`s and `RDATE`s go to the half they fall in. Attendees get the usual invitations, controlled by `sendUpdates`. If ending the old series fails, calsdk deletes the new one; if that delete fails too, the error names the new series so you can remove it.
- **Moving a series.** A new `start` with scope `all` or `thisAndFollowing` moves the series on the wall clock of its time zone, so occurrences keep their local time across DST changes. Weekdays, `UNTIL`, `EXDATE` and `RDATE` move with it. Rules that pick days of the month or year cannot be moved this way and throw `UnsupportedFunctionalityError`.
- **Edited occurrences.** Google resets single-instance changes when a series moves or splits. Deleted occurrences are kept (calsdk adds them as `EXDATE`s); edited ones lose their changes, with a `compatibility` warning.
- **Free/busy** uses Google's `/freeBusy` endpoint, so events shown as free are ignored and calendars you can only see as free/busy work.
- **Sync** uses Google sync tokens. An expired token throws `SyncCursorExpiredError`: discard it and run a full sync.

## Provider options

```ts
await createEvent({
  calendar,
  event,
  providerOptions: {
    google: { guestsCanModify: true, extendedProperties: { private: { orderId: '42' } } },
  },
});

await listEvents({
  calendar,
  timeMin,
  timeMax,
  providerOptions: { google: { eventTypes: ['default'] } },
});
```

Events carry `providerMetadata.google` with `iCalUID`, `eventType` and `extendedProperties`.
