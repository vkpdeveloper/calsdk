---
'@cal-sdk/provider-utils': patch
'@cal-sdk/mock': patch
---

Event times without an offset, such as `{ dateTime: '2026-11-09T10:00:00', timeZone: 'Europe/Berlin' }`, are read in their own time zone instead of the machine's. This fixes busy times, listing windows and recurrence expansion in the mock calendar.
