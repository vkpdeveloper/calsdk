# @calsdk/microsoft

Microsoft Outlook calendar provider for calsdk, built on Microsoft Graph. Uses `fetch` only, so it runs on Node, Bun, Deno and edge runtimes. Works with work, school and personal Microsoft accounts.

```ts
import { microsoft } from '@calsdk/microsoft';
import { listEvents } from 'calsdk';

const calendar = microsoft({ accessToken: () => getFreshAccessToken() });

const { events } = await listEvents({ calendar, timeMin: '2026-11-01', timeMax: '2026-12-01' });
```

`accessToken` is a Microsoft Graph token with `Calendars.ReadWrite` (or `Calendars.Read` for read-only use). calsdk does not run OAuth flows: pass a function to refresh tokens yourself. Settings also take `baseURL`, `headers` and `fetch`.

## Behavior

- **Ids.** calsdk asks Graph for immutable ids, so event ids stay the same when an event moves to another calendar.
- **Time zones.** Events keep the zone they were scheduled in. Outlook's Windows zone names are mapped to IANA names.
- **Recurrence.** Outlook stores patterns, not RRULEs. Rules with an exact Outlook equivalent are converted both ways. Others, such as `RDATE`, `FREQ=HOURLY` or `BYMONTHDAY=31` alone, throw `UnsupportedFunctionalityError` instead of saving a different schedule. Outlook moves a day a month lacks (the 31st) to the month's last day, which reads back as `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`.
- **Deleted occurrences** read back as `EXDATE` lines on the series. Reading them costs one extra request per series. Outlook has no exclusion list, so `EXDATE` lines can only repeat occurrences already deleted: to exclude a new one, delete that occurrence.
- **`thisAndFollowing`** is not supported and throws `UnsupportedFunctionalityError`. Scopes `this` and `all` work. Moving one occurrence with scope `all` moves the series by the same wall-clock distance; moving a monthly or yearly series to another day this way throws, since its pattern would pick different days.
- **Conditional deletes.** Outlook ignores `If-Match` on deletes, so `deleteEvent` with `ifMatch` compares the etag first. A change made between that read and the delete is not detected.
- **Search** is not supported: `query` throws `UnsupportedFunctionalityError`.
- **Colors.** Outlook events have no color of their own, only categories. `color` is ignored with a warning.
- **Reminders.** One popup reminder per event. Outlook has no default reminder to return to, so `reminders: null` and `useDefault: true` leave the reminder unchanged and warn. To turn it off, pass `{ useDefault: false, overrides: [] }`.
- **Teams meetings.** `createConference: true` asks for a Teams meeting. Personal accounts cannot create one through Graph: the event is saved without it and the result carries a warning.
- **`sendUpdates`.** Outlook always notifies attendees, so values other than `'all'` return a warning.
- **Free/busy** is computed by calsdk from events.
- **Sync** uses Graph delta queries over a fixed window, by default one year back and two years ahead of the initial sync. The cursor keeps the window. Changes cover single events, series and modified occurrences. Deleting one occurrence changes its series, so it arrives as an update of the series with a new `EXDATE` line. An expired cursor throws `SyncCursorExpiredError`: discard it and run a full sync.

## Provider options

```ts
await createEvent({
  calendar,
  event,
  providerOptions: {
    microsoft: { showAs: 'oof', importance: 'high', categories: ['Travel'], transactionId: 'abc' },
  },
});

await syncEvents({
  calendar,
  providerOptions: {
    microsoft: { timeMin: '2026-01-01T00:00:00Z', timeMax: '2027-01-01T00:00:00Z' },
  },
});
```

`transactionId` makes a create safe to retry. Events carry `providerMetadata.microsoft` with Outlook's own `showAs` (`'tentative'`, `'oof'`, `'workingElsewhere'` and so on), `importance`, `categories` and `iCalUId`.
