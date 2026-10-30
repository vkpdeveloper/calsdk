# @calsdk/ics

ICS feed provider for calsdk: reads a subscribed iCalendar feed, such as a holiday calendar or a calendar shared by its secret address. Uses `fetch` only, so it runs on Node, Bun, Deno and edge runtimes.

```ts
import { ics } from '@calsdk/ics';
import { listEvents, syncEvents } from 'calsdk';

const calendar = ics({ url: 'webcal://example.com/holidays.ics' });

const { events } = await listEvents({ calendar, timeMin: '2026-11-01', timeMax: '2026-12-01' });

// Later: what changed since the last sync.
const { changes, nextCursor } = await syncEvents({ calendar, cursor });
```

Settings also take `timeZone` (for times the feed gives without one, when it declares no `X-WR-TIMEZONE`), `headers` (for example `authorization` for a feed behind a password) and `fetch`.

## Behavior

- **Read only.** The feed is the `'primary'` calendar. Creating, updating and deleting throw `UnsupportedFunctionalityError`.
- **Every call downloads the feed.** There is no cache between calls.
- **Ids.** An event id is the feed's `UID`. Instances of a series are `<UID>_<original start>`, the start being a UTC date-time (`20261103T100000Z`) or, for all-day series, a date (`20261103`), as on Google.
- **Recurring events** are expanded by calsdk, with their `EXDATE`s and their moved and cancelled instances. A series stops after 50,000 instances with a warning, and so does a rule that matches too few dates (`BYMONTHDAY=30` in February). Rules repeating every minute or second list only their first instance. An instance that falls in the hour skipped when clocks go forward is shown an hour later, as Google, Apple and Outlook show it, where RFC 5545 leaves it out.
- **Time zones.** IANA names, Windows names (Outlook) and zones defined only in the feed are all understood. Times in UTC, without a zone, or in a zone defined only in the feed are shown in the calendar's zone. In a zone defined only in the feed, a time within the hour the clocks change may be off by that hour.
- **Sync** compares each single event, series and moved instance with the last sync, so the cursor holds a short fingerprint per event. A cancelled instance is reported once as a delete, in the first sync too. When the server confirms the feed has not changed (`ETag` or `Last-Modified`), the feed is not downloaded again.
- **Meeting links.** Google Meet, Teams and Zoom links in the event become its `conference`.
- **Secret addresses.** Errors only report the feed's origin, never its path or query, and redirects to another origin do not get your `headers`.
- **Not supported:** search, reminders and colors.
