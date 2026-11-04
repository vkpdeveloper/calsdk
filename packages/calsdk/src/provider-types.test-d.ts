// Compile-time checks for provider-typed options and metadata. `bun run typecheck` runs them.
import type { CalendarProviderV1, JSONValue } from '@calsdk/provider';
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
// Declarations that every default-typed provider would also satisfy.
type Narrow = CalendarProviderV1<
  'narrow',
  { options: { createEvent?: { flag?: boolean } }; eventMetadata: { tag?: string } }
>;
type Empty = CalendarProviderV1<
  'empty',
  { options: Record<never, never>; eventMetadata: Record<never, never> }
>;

// Payloads must be JSON: options are sent as JSON and metadata is read from it.
type BigOptions = CalendarProviderV1<
  'big',
  // @ts-expect-error a bigint option
  { options: { createEvent: { n: bigint } }; eventMetadata: never }
>;

// A provider written before declared types: a literal id and no `~types`.
type Legacy = Omit<CalendarProviderV1, 'provider' | '~types'> & { readonly provider: 'legacy' };

declare const acme: Acme;
declare const legacy: Legacy;
declare const either: Acme | Other;
declare const narrow: Narrow;
declare const empty: Empty;
declare const untyped: CalendarProviderV1;
declare const event: EventInput;
const window = { timeMin: '2026-11-01T00:00:00Z', timeMax: '2026-11-02T00:00:00Z' };

export type { BigOptions };

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

  // Providers without declared types accept any JSON options, under their own key.
  await createEvent({ calendar: legacy, event, providerOptions: { legacy: { custom: true } } });
  // @ts-expect-error another provider's key
  await createEvent({ calendar: legacy, event, providerOptions: { other: { custom: true } } });
  const legacyEvent = (await getEvent({ calendar: legacy, eventId: 'e' })).event;
  expectTypeOf(legacyEvent.providerMetadata?.legacy?.custom).toEqualTypeOf<JSONValue | undefined>();
  await createEvent({ calendar: untyped, event, providerOptions: { anything: { a: [1] } } });

  await createEvent({ calendar: narrow, event, providerOptions: { narrow: { flag: true } } });
  // @ts-expect-error undeclared option of an optional operation key
  await createEvent({ calendar: narrow, event, providerOptions: { narrow: { bogus: true } } });
  // @ts-expect-error options for an operation the provider reads none for
  await getEvent({ calendar: narrow, eventId: 'e', providerOptions: { narrow: { flag: true } } });
  const narrowEvent = (await getEvent({ calendar: narrow, eventId: 'e' })).event;
  expectTypeOf(narrowEvent.providerMetadata?.narrow).toEqualTypeOf<{ tag?: string } | undefined>();
  // @ts-expect-error a provider that declares no options
  await createEvent({ calendar: empty, event, providerOptions: { empty: { bogus: true } } });

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
