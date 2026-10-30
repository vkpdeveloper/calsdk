# @calsdk/provider

The contract every calsdk calendar provider implements: the `CalendarProviderV1` type, the normalized data model (`EventV1`, `CalendarV1`, ...) and the error classes. Types and errors only, no runtime dependencies.

Apps use [`calsdk`](../calsdk) and a provider package. You only need this package to write a provider.

```ts
import type { CalendarProviderV1 } from '@calsdk/provider';

// Optional: declare your `providerOptions` and `providerMetadata` entries so calsdk checks them.
type FastmailTypes = {
  options: { createEvent: { sendReminder?: boolean } };
  eventMetadata: { uid?: string };
};

export function fastmail(
  settings: FastmailSettings,
): CalendarProviderV1<'fastmail', FastmailTypes> {
  return {
    specificationVersion: 'v1',
    provider: 'fastmail',
    capabilities: {
      /* ... */
    },
    async doListCalendars(options) {
      /* ... */
    },
    // doGetEvent, doListEvents, doCreateEvent, doUpdateEvent, doDeleteEvent
  };
}
```
