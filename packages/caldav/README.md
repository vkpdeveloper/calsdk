# @calsdk/caldav

CalDAV provider for calsdk: iCloud, Fastmail, Nextcloud, Radicale and other CalDAV servers (RFC 4791). Uses `fetch` only, so it runs on Node, Bun, Deno and edge runtimes.

```ts
import { caldav, icloud } from '@calsdk/caldav';
import { createEvent, listCalendars } from 'calsdk';

// iCloud needs an app-specific password, made at account.apple.com under Sign-In and Security.
const calendar = icloud({ appleId: 'me@icloud.com', appPassword: process.env.ICLOUD_APP_PASSWORD });

// Any other server: its CalDAV address and the account's credentials.
const fastmail = caldav({
  serverUrl: 'https://caldav.fastmail.com/dav/',
  username: 'me@fastmail.com',
  password: process.env.FASTMAIL_APP_PASSWORD,
});

const { calendars } = await listCalendars({ calendar });
await createEvent({
  calendar,
  event: {
    title: 'Design review',
    start: { dateTime: '2026-11-03T10:00:00', timeZone: 'Asia/Kolkata' },
    end: { dateTime: '2026-11-03T10:30:00', timeZone: 'Asia/Kolkata' },
  },
});
```

Settings also take `timeZone` (for times stored without one, and for the bounds of all-day events in listings), `headers` and `fetch`.

## Behavior

- **Discovery.** The provider finds the account's calendars from the server address, once per provider. `'primary'` is the server's default calendar for invitations, or else the first calendar that holds events. Task lists are not listed.
- **Ids.** A calendar id is the calendar's path, as `listCalendars` returns it. An event id is the name of its `.ics` resource without the extension, normally its `UID`. Instances of a series are `<id>_<original start>`, the start being a UTC date-time (`20261103T100000Z`) or, for all-day series, a date (`20261103`), as on Google.
- **Recurring events** are expanded by calsdk. Changing one instance stores an exception, deleting one adds an `EXDATE`. Changing a whole series through one of its instances moves the series by as much as that instance moved. When a series changes its start or its rule, exceptions for instances it no longer has are dropped. `scope: 'thisAndFollowing'` is not supported.
- **Etags.** Updates and deletes pass `ifMatch` to the server, and a stale one throws `ConflictError`. Every update is conditional on the version just read, so a change made in between is never overwritten.
- **Sync** uses the server's sync tokens (RFC 6578). Each sync reports the single events, series and exceptions that changed, never computed occurrences. A token the server no longer accepts throws `SyncCursorExpiredError`.
- **Attendees** are invited by the server, from the account's email address. `sendUpdates: 'none'` asks the server not to send invitations.
- **Credentials** are only sent to the server's own origin and to the HTTPS host discovery finds the calendars on (iCloud keeps them on a host of their own). A redirect anywhere else fails.
- **Not supported:** search, meeting links, reminders, colors and webhooks. Resources whose names do not end in `.ics` are skipped.
