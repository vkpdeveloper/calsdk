// Compile-time checks for provider-typed options and metadata. `bun run typecheck` runs them.
import type { CalendarProviderV1 } from '@calsdk/provider';
import { expectTypeOf } from 'vitest';
import { createEvent } from './create-event';
import { getEvent } from './get-event';
import { iterateEvents, listEvents } from './list-events';
import { syncEvents } from './sync-events';
import type { CalendarEvent, EventInput } from './types';

type Acme = CalendarProviderV1<
  'acme',
  {
    options: { createEvent: { color?: 'red' | 'blue' }; listEvents: { archived?: boolean } };
    eventMetadata: { ticket?: string };
  }
>;
type Other = CalendarProviderV1<
  'other',
  { options: { createEvent: { flag?: boolean } }; eventMetadata: { score?: number } }
>;

declare const acme: Acme;
declare const either: Acme | Other;
declare const untyped: CalendarProviderV1;
declare const event: EventInput;
const window = { timeMin: '2026-11-01T00:00:00Z', timeMax: '2026-11-02T00:00:00Z' };

export async function checks() {
  await createEvent({ calendar: acme, event, providerOptions: { acme: { color: 'red' } } });
  // @ts-expect-error misspelled option
  await createEvent({ calendar: acme, event, providerOptions: { acme: { colour: 'red' } } });
  // @ts-expect-error wrong option value
  await createEvent({ calendar: acme, event, providerOptions: { acme: { color: 'green' } } });
  // @ts-expect-error another provider's key
  await createEvent({ calendar: acme, event, providerOptions: { other: { flag: true } } });
  // @ts-expect-error options for an operation the provider reads none for
  await getEvent({ calendar: acme, eventId: 'e', providerOptions: { acme: { color: 'red' } } });
  await listEvents({ calendar: acme, ...window, providerOptions: { acme: { archived: true } } });

  // Each provider in a union checks its own key.
  await createEvent({
    calendar: either,
    event,
    providerOptions: { acme: { color: 'blue' }, other: { flag: true } },
  });
  // @ts-expect-error wrong value for one member of the union
  await createEvent({ calendar: either, event, providerOptions: { other: { flag: 'yes' } } });

  // Providers without declared types accept any JSON options.
  await createEvent({ calendar: untyped, event, providerOptions: { anything: { a: [1] } } });

  const created = await createEvent({ calendar: acme, event });
  expectTypeOf(created.event.providerMetadata).toEqualTypeOf<
    { acme?: { ticket?: string } } | undefined
  >();
  expectTypeOf(created.event.title).toEqualTypeOf<string | undefined>();

  for await (const listed of iterateEvents({ calendar: either, ...window })) {
    expectTypeOf(listed.providerMetadata?.other?.score).toEqualTypeOf<number | undefined>();
  }

  const { changes } = await syncEvents({ calendar: acme });
  for (const change of changes) {
    if (change.type === 'upsert') {
      expectTypeOf(change.event.providerMetadata?.acme?.ticket).toEqualTypeOf<string | undefined>();
    }
  }

  const loose = await getEvent({ calendar: untyped, eventId: 'e' });
  expectTypeOf(loose.event).toEqualTypeOf<CalendarEvent>();
}
