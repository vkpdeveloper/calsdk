<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="calsdk" height="44">
  </picture>
</h1>

**Every calendar. One API.**

Events, free time and sync for nine providers, including Google Calendar, Outlook and iCloud, in one typed TypeScript API.

[Website](https://www.cal-sdk.com) · [Docs](https://www.cal-sdk.com/docs) · [Quickstart](https://www.cal-sdk.com/docs/quickstart) · [FAQ](https://www.cal-sdk.com/docs/faq)

The website opens with a live demo. It runs in your browser on six sample calendars, using the real `listEvents`, `findFreeTime` and `createEvent`.

## Try it

```bash
npm i calsdk @calsdk/mock
```

`@calsdk/mock` keeps a calendar in memory, so you can try everything without an account or a network:

```ts
import { createEvent, findFreeTime, listEvents } from 'calsdk';
import { mockCalendar } from '@calsdk/mock';

const calendar = mockCalendar();

await createEvent({
  calendar,
  event: {
    title: 'Standup',
    start: { dateTime: '2026-11-09T09:30:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-09T09:45:00', timeZone: 'Europe/Berlin' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  },
});

const { events } = await listEvents({
  calendar,
  timeMin: '2026-11-09T00:00:00+01:00',
  timeMax: '2026-11-14T00:00:00+01:00',
});

const { slots } = await findFreeTime({
  calendars: [{ calendar }],
  timeMin: '2026-11-09T00:00:00+01:00',
  timeMax: '2026-11-10T00:00:00+01:00',
  duration: 30,
  workingHours: { start: '09:00', end: '11:00', timeZone: 'Europe/Berlin' },
});
```

## Switch calendars, not code

When the logic works, swap the mock for a real calendar. Only the import and the line that creates `calendar` change, and events come back in the same shape from every provider.

```ts
import { google } from '@calsdk/google';

const calendar = google({ accessToken: () => getFreshAccessToken() });
```

| Provider | Package | Read | Write | Recurring | Video links | Sync |
| --- | --- | --- | --- | --- | --- | --- |
| Google Calendar | `@calsdk/google` | ✓ | ✓ | ✓ | Google Meet | ✓ |
| Outlook and Microsoft 365 | `@calsdk/microsoft` | ✓ | ✓ | ✓ | Teams, work accounts | ✓ |
| iCloud | `@calsdk/caldav` | ✓ | ✓ | ✓ | | ✓ |
| Zoho Calendar | `@calsdk/caldav` | ✓ | ✓ | ✓ | | ✓ |
| Any CalDAV server | `@calsdk/caldav` | ✓ | ✓ | ✓ | | ✓ |
| Zoom | `@calsdk/zoom` | ✓ | ✓ | Zoom's patterns | Zoom | ✓ |
| Cal.com | `@calsdk/calcom` | ✓ | Book an event type, move, cancel | | | ✓ |
| Calendly | `@calsdk/calendly` | ✓ | Book an event type, cancel | | | ✓ |
| ICS feed | `@calsdk/ics` | ✓ | | | | ✓ |

[Compare providers](https://www.cal-sdk.com/docs/providers) has the full list of what each one can do.

## What it handles for you

- **Recurrence is always an RRULE.** Outlook stores a pattern object and Zoom numbers its weekdays. You read and write one RRULE, and listing expands a series into occurrences you can move one at a time, or all together.
- **Time zones that survive clock changes.** A 9:30 New York standup stays at 9:30 in New York, wherever it's viewed from.
- **Warnings, not silent changes.** When a provider can't do exactly what you asked, such as a color outside Google's palette, the call saves what it can and returns a warning. If going ahead would lose data, it throws instead.
- **Free time across providers.** `findFreeTime` finds slots when a Google calendar and an Outlook calendar are both free.
- **Sync.** `syncEvents` returns only what changed since a saved cursor. An expired cursor is its own error, so a full resync is one branch.
- **Errors you can branch on.** Conflicts, rate limits, auth failures and missing events each have their own error class.
- **Types that follow the calendar.** Provider options are checked against the calendar you pass, so a misspelled option fails to compile.

## Good to know

- **It's a library, not a hosted service.** It runs in your app and calls each provider directly with tokens you pass in. Your users' calendar data doesn't pass through anyone else.
- **It doesn't run OAuth.** Pass a token, or a function that returns a fresh one.
- **It runs anywhere with `fetch`.** Node.js 20 or later, Bun, Deno and edge runtimes, with no vendor SDKs.
- **It's tested on the real APIs.** Google, Outlook, Zoho, Zoom, Cal.com and Calendly are recorded live and replayed in CI.
- **You can add your own provider.** A provider is one object with a few functions, checked by a shared conformance suite. See [Build a provider](https://www.cal-sdk.com/docs/build-a-provider).

## Working on calsdk

This repo uses [Bun](https://bun.sh).

```bash
bun install
bun run build       # build the packages
bun run test
bun run typecheck
bun run lint
```

The website and docs live in `apps/web`. Build the packages first, then run `bun run dev` in `apps/web`.

## License

[MIT](LICENSE)
