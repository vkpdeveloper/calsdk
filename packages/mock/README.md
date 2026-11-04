# @calsdk/mock

An in-memory calendar provider for calsdk. Use it to try the SDK without credentials, to test your app's calendar logic offline, and as the reference implementation when writing a provider.

```ts
import { mockCalendar } from '@calsdk/mock';
import { listEvents } from 'calsdk';

const calendar = mockCalendar({
  events: [
    {
      title: 'Standup',
      start: { dateTime: '2026-11-02T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
      end: { dateTime: '2026-11-02T10:15:00+05:30', timeZone: 'Asia/Kolkata' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    },
  ],
});

const { events } = await listEvents({
  calendar,
  timeMin: '2026-11-01',
  timeMax: '2026-12-01',
  expandRecurring: true,
});
console.log(calendar.events); // inspect stored state
```

Recurrence follows RFC 5545 through [`rrule-temporal`](https://github.com/ggaabe/rrule-temporal): one `RRULE` line plus `EXDATE` lines. `RDATE` and `EXRULE` throw `UnsupportedFunctionalityError`.
