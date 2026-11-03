import Link from 'next/link';
import type { ReactNode } from 'react';
import { highlightCode } from '@/components/landing/code';
import { CopyCommand } from '@/components/landing/copy-command';
import { FreeTimeDemo } from '@/components/landing/free-time-demo';
import { TabbedCode } from '@/components/landing/tabbed-code';
import { Mark } from '@/components/logo';
import { githubUrl } from '@/lib/shared';

const PROVIDERS = [
  { id: 'google', label: 'Google', pkg: 'google', setup: 'google({ accessToken })' },
  { id: 'microsoft', label: 'Outlook', pkg: 'microsoft', setup: 'microsoft({ accessToken })' },
  { id: 'icloud', label: 'iCloud', pkg: 'caldav', setup: 'icloud({ appleId, appPassword })' },
  { id: 'zoho', label: 'Zoho', pkg: 'caldav', setup: 'zoho({ email, password })' },
  {
    id: 'caldav',
    label: 'CalDAV',
    pkg: 'caldav',
    setup: 'caldav({ serverUrl, username, password })',
  },
  { id: 'zoom', label: 'Zoom', pkg: 'zoom', setup: 'zoom({ accessToken })' },
  { id: 'calcom', label: 'Cal.com', pkg: 'calcom', setup: 'calcom({ accessToken })' },
  { id: 'calendly', label: 'Calendly', pkg: 'calendly', setup: 'calendly({ accessToken })' },
  {
    id: 'ics',
    label: 'ICS feed',
    pkg: 'ics',
    setup: "ics({ url: 'webcal://example.com/team.ics' })",
  },
];

const providerCode = (id: string, pkg: string, setup: string) => `
import { listEvents } from 'calsdk';
import { ${id} } from '@calsdk/${pkg}';

const calendar = ${setup};

const { events } = await listEvents({
  calendar,
  timeMin: '2026-11-01',
  timeMax: '2026-12-01',
});`;

const demoCode = (duration: number) => `
const { slots } = await findFreeTime({
  calendars: [{ calendar: you }, { calendar: sam }],
  timeMin: '2027-01-11T00:00:00-05:00',
  timeMax: '2027-01-16T00:00:00-05:00',
  duration: ${duration},
  slotInterval: 30,
  workingHours: {
    start: '09:00',
    end: '18:00',
    timeZone: 'America/New_York',
  },
});`;

const EXAMPLES = [
  {
    id: 'book',
    label: 'Book a meeting',
    note: 'createConference adds a Google Meet link on Google and a Teams link on Outlook.',
    code: `
import { createEvent } from 'calsdk';

const { event, warnings } = await createEvent({
  calendar,
  event: {
    title: 'Intro call',
    start: { dateTime: '2026-11-12T15:00:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-12T15:30:00', timeZone: 'Europe/Berlin' },
    attendees: [{ email: 'guest@example.com' }],
    createConference: true,
  },
  sendUpdates: 'all',
});

event.conference?.joinUrl;`,
  },
  {
    id: 'recurring',
    label: 'Recurring events',
    note: 'Series are plain RRULEs. Listing expands them, and each instance has its own id.',
    code: `
await createEvent({
  calendar,
  event: {
    title: 'Standup',
    start: { dateTime: '2026-11-09T09:30:00', timeZone: 'America/New_York' },
    end: { dateTime: '2026-11-09T09:45:00', timeZone: 'America/New_York' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  },
});

const { events } = await listEvents({ calendar, timeMin: '2026-11-09', timeMax: '2026-11-14' });
const [, , , , friday] = events; // Monday to Friday

// Move only Friday's standup. 'all' and 'thisAndFollowing' change more of the series.
await updateEvent({
  calendar,
  eventId: friday.id,
  scope: 'this',
  patch: {
    start: { dateTime: '2026-11-13T10:00:00', timeZone: 'America/New_York' },
    end: { dateTime: '2026-11-13T10:15:00', timeZone: 'America/New_York' },
  },
});`,
  },
  {
    id: 'sync',
    label: 'Sync',
    note: 'The first call returns everything. Later calls return only what changed.',
    code: `
import { SyncCursorExpiredError, syncEvents } from 'calsdk';

try {
  const { changes, nextCursor } = await syncEvents({ calendar, cursor: await db.cursor() });

  for (const change of changes) {
    if (change.type === 'delete') await db.remove(change.eventId);
    else await db.save(change.event);
  }
  await db.saveCursor(nextCursor);
} catch (error) {
  // The provider forgot the cursor: start over with a full sync.
  if (SyncCursorExpiredError.isInstance(error)) await db.clear();
  else throw error;
}`,
  },
  {
    id: 'typed',
    label: 'Typed options',
    note: 'Options and metadata are typed by the provider you pass, so a typo is a compile error.',
    code: `
const calendar = google({ accessToken });

await createEvent({
  calendar,
  event,
  providerOptions: {
    google: { guestsCanModify: true },
  },
});

// Type error: Google has no \`guestsCanModfy\` option.
await createEvent({ calendar, event, providerOptions: { google: { guestsCanModfy: true } } });

const { event: created } = await createEvent({ calendar, event });
created.providerMetadata?.google?.iCalUID; // string | undefined`,
  },
  {
    id: 'errors',
    label: 'Errors',
    note: 'Every error extends CalsdkError. isInstance works even with two copies of calsdk installed.',
    code: `
import { ConflictError, RateLimitError, updateEvent } from 'calsdk';

try {
  // Only update if nobody changed the event since we read it.
  await updateEvent({ calendar, eventId: event.id, ifMatch: event.etag, patch: { title } });
} catch (error) {
  if (ConflictError.isInstance(error)) return reloadAndAskAgain();
  if (RateLimitError.isInstance(error)) return retryLater();
  throw error;
}`,
  },
];

const ROWS: [name: string, pkg: string, write: string, recurring: string, links: string][] = [
  ['Google Calendar', 'google', 'Yes', 'Yes', 'Google Meet'],
  ['Microsoft Outlook', 'microsoft', 'Yes', 'Yes', 'Teams'],
  ['iCloud', 'caldav', 'Yes', 'Yes', 'No'],
  ['Zoho Calendar', 'caldav', 'Yes', 'Yes', 'No'],
  ['Any CalDAV server', 'caldav', 'Yes', 'Yes', 'No'],
  ['Zoom', 'zoom', 'Yes', "Zoom's patterns", 'Zoom'],
  ['Cal.com', 'calcom', 'Book, move, cancel', 'No', 'No'],
  ['Calendly', 'calendly', 'Book, cancel', 'No', 'No'],
  ['ICS feeds', 'ics', 'Read only', 'Yes', 'No'],
];

const PROVIDER_CODE = `
import type { CalendarProviderV1 } from '@calsdk/provider';

export function fastmail(settings: FastmailSettings): CalendarProviderV1<'fastmail'> {
  return {
    specificationVersion: 'v1',
    provider: 'fastmail',
    capabilities: { /* what it supports */ },
    async doListCalendars(options) { /* ... */ },
    // doGetEvent, doListEvents, doCreateEvent, doUpdateEvent, doDeleteEvent
  };
}`;

const CONFORMANCE_CODE = `
import { describeProviderConformance } from '@calsdk/provider-tests';

describeProviderConformance({
  name: 'fastmail',
  createProvider: ({ fetch }) => fastmail({ token, fetch }),
  recording: {
    path: 'test/fixtures/conformance.json',
    mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
  },
});`;

export default async function HomePage() {
  const providerTabs = await Promise.all(
    PROVIDERS.map(async ({ id, label, pkg, setup }) => ({
      id,
      label,
      code: await highlightCode(providerCode(id, pkg, setup), [2, 4]),
    })),
  );
  const lengths = await Promise.all(
    [30, 60, 90].map(async (minutes) => ({
      minutes,
      code: await highlightCode(demoCode(minutes), [5]),
    })),
  );
  const examples = await Promise.all(
    EXAMPLES.map(async ({ id, label, note, code }) => ({
      id,
      label,
      note,
      code: await highlightCode(code),
    })),
  );
  const [contractCode, conformanceCode] = await Promise.all([
    highlightCode(PROVIDER_CODE),
    highlightCode(CONFORMANCE_CODE),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <section className="grid items-center gap-10 py-16 sm:py-24 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.035em] text-white sm:text-6xl">
            One API for every calendar
          </h1>
          <p className="mt-5 max-w-xl text-lg text-neutral-400">
            Read, write and sync events on Google Calendar, Outlook, iCloud, Zoom, Cal.com and more.
            The same functions and types on every provider.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/docs/quickstart"
              className="flex h-11 items-center rounded-lg bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200"
            >
              Get started
            </Link>
            <a
              href={githubUrl}
              className="flex h-11 items-center rounded-lg border border-line px-5 text-sm font-medium text-neutral-200 hover:border-neutral-600"
            >
              GitHub
            </a>
          </div>
          <div className="mt-6">
            <CopyCommand command="bun add calsdk @calsdk/google" />
          </div>
        </div>
        <TabbedCode
          label="Provider"
          tabs={providerTabs.map((tab) => ({
            ...tab,
            note: 'Switch providers: only the blue lines change.',
          }))}
        />
      </section>

      <Section
        id="demo"
        title="Find a time that works for everyone"
        intro="This is calsdk running in your browser, on two in-memory calendars. Change the length, then book a slot to put it on both."
      >
        <FreeTimeDemo lengths={lengths} />
      </Section>

      <Section id="examples" title="The calendar code you would rather not write">
        <TabbedCode label="Example" tabs={examples} />
      </Section>

      <Section id="why" title="Why calsdk">
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          <Point title="Built on fetch">
            No vendor SDKs. It runs on Node, Bun, Deno and edge runtimes.
          </Point>
          <Point title="Tested against real accounts">
            Every provider is recorded against its real API and replayed in CI by one shared test
            suite.
          </Point>
          <Point title="Clear about gaps">
            When a provider cannot do something, you get a warning or an error, never a quietly
            different event.
          </Point>
        </div>
      </Section>

      <Section id="providers" title="Providers">
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-panel text-neutral-400">
              <tr>
                {['Provider', 'Package', 'Write', 'Recurring', 'Meeting links', 'Sync'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROWS.map(([name, pkg, write, recurring, links]) => (
                <tr key={name}>
                  <td className="px-4 py-3 font-medium text-white">{name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-400">@calsdk/{pkg}</td>
                  <Cell value={write} />
                  <Cell value={recurring} />
                  <Cell value={links} />
                  <Cell value="Yes" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-neutral-400">
          Free/busy and findFreeTime work on all of them, and across them.
        </p>
      </Section>

      <Section
        id="your-provider"
        title="Add any calendar"
        intro="A provider is one object with a few functions. Run the same conformance suite the official providers pass."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="code overflow-hidden rounded-xl border border-line bg-panel">
            {contractCode}
          </div>
          <div className="code overflow-hidden rounded-xl border border-line bg-panel">
            {conformanceCode}
          </div>
        </div>
      </Section>

      <section className="flex flex-col items-center gap-6 border-t border-line py-20 text-center">
        <Mark className="size-12 text-white" />
        <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">
          Try it without credentials
        </h2>
        <CopyCommand command="bun add calsdk @calsdk/mock" />
        <Link href="/docs/quickstart" className="text-sm text-accent-blue hover:underline">
          Read the quickstart
        </Link>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-8 text-sm text-neutral-500">
        <span>MIT License</span>
        <div className="flex gap-5">
          <Link href="/docs" className="hover:text-white">
            Docs
          </Link>
          <a href={githubUrl} className="hover:text-white">
            GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line py-16 sm:py-20">
      <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{title}</h2>
      {intro && <p className="mt-3 max-w-2xl text-neutral-400">{intro}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-fd-background p-6">
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-neutral-400">{children}</p>
    </div>
  );
}

function Cell({ value }: { value: string }) {
  const tone =
    value === 'No' ? 'text-neutral-600' : value === 'Yes' ? 'text-neutral-200' : 'text-neutral-300';
  return <td className={`px-4 py-3 ${tone}`}>{value}</td>;
}
