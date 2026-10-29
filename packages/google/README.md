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
- **`thisAndFollowing`.** calsdk creates a new series from the chosen instance, copying attendees and the existing meeting link, then ends the old series the moment before it. Changes made to single instances after the split are not copied to the new series. Attendees get the usual invitations, controlled by `sendUpdates`.
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
