# @calsdk/provider-tests

Conformance tests for calsdk calendar providers, plus a `fetch` that records and replays HTTP traffic. Official and third-party providers run the same suite.

```ts
// test/conformance.test.ts
import { describeProviderConformance } from '@calsdk/provider-tests';
import { google } from '@calsdk/google';

describeProviderConformance({
  name: 'google',
  createProvider: ({ fetch }) =>
    google({ accessToken: process.env.GOOGLE_ACCESS_TOKEN ?? 'replay', fetch }),
  recording: {
    path: 'test/fixtures/conformance.json',
    mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
  },
});
```

The suite covers calendars, event CRUD, all-day and time zone round trips, pagination, recurring series and their exceptions, etags, sync, free/busy and HTTP error mapping. Tests run only for capabilities the provider declares as `true`.

## Recording

- **Replay** (default): no network and no credentials. Fails when a request has no recorded response.
- **Record**: calls the real API and saves responses per test. Use a dedicated test calendar (`calendarId`): tests delete what they create, but they write to it.
- **Live**: omit `recording` to call the real API without saving anything.

Request headers are never saved. Response bodies are saved as returned, so review a recording before committing it.

`createRecordingFetch` is exported for a provider's own tests.

Requires Vitest 5 and a runtime with `node:fs`.
