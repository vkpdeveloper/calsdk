# @calsdk/provider-utils

Helpers for writing calsdk providers: a JSON fetch client, error mapping, provider options parsing, time zone and recurrence helpers. Official providers use exactly these, so community providers get the same tools.

```ts
import { createJsonFetcher, mapAPICallError, urlPath } from '@calsdk/provider-utils';

const request = createJsonFetcher({ baseURL: 'https://api.example.com', accessToken });

try {
  const { value } = await request({ method: 'GET', path: urlPath`/events/${eventId}`, schema });
} catch (error) {
  throw mapAPICallError(error, { provider: 'example', resource: { type: 'event', id: eventId } });
}
```
