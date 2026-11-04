import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ClockChange } from '@/components/landing/clock-change';
import { highlightCode } from '@/components/landing/code';
import { CopyCommand } from '@/components/landing/copy-command';
import { FeatureTabs } from '@/components/landing/feature-tabs';
import { FieldCompare } from '@/components/landing/field-compare';
import { FreeTimeDemo } from '@/components/landing/free-time-demo';
import { ProviderShowcase } from '@/components/landing/provider-showcase';
import { Mark } from '@/components/logo';
import { githubUrl } from '@/lib/shared';

const PROVIDERS = [
  {
    id: 'google',
    label: 'Google',
    pkg: 'google',
    color: '#8ab4f8',
    setup: 'google({ accessToken })',
  },
  {
    id: 'microsoft',
    label: 'Outlook',
    pkg: 'microsoft',
    color: '#4cc2ff',
    setup: 'microsoft({ accessToken })',
  },
  {
    id: 'icloud',
    label: 'iCloud',
    pkg: 'caldav',
    color: '#ff7a70',
    setup: 'icloud({ appleId, appPassword })',
  },
  {
    id: 'zoho',
    label: 'Zoho',
    pkg: 'caldav',
    color: '#ffc857',
    setup: 'zoho({ email, password })',
  },
  {
    id: 'caldav',
    label: 'CalDAV',
    pkg: 'caldav',
    color: '#b8b8c0',
    setup: 'caldav({ serverUrl, username, password })',
  },
  { id: 'zoom', label: 'Zoom', pkg: 'zoom', color: '#6c8cff', setup: 'zoom({ accessToken })' },
  {
    id: 'calcom',
    label: 'Cal.com',
    pkg: 'calcom',
    color: '#f2f2f2',
    setup: 'calcom({ accessToken })',
  },
  {
    id: 'calendly',
    label: 'Calendly',
    pkg: 'calendly',
    color: '#5aa9ff',
    setup: 'calendly({ accessToken })',
  },
  {
    id: 'ics',
    label: 'ICS feed',
    pkg: 'ics',
    color: '#8fe0b0',
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

// One weekday standup with a video link, as each API returns it. `«field»` marks the lines
// that FieldCompare lights up together.
const PAYLOADS = [
  {
    name: 'Google Calendar',
    format: 'JSON',
    lang: 'json',
    conference: { provider: 'google-meet', joinUrl: 'https://meet.google.com/abc-defg-hij' },
    code: `
{
  "summary": "Standup",«title»
  "start": {«start»
    "dateTime": "2026-11-09T09:30:00-05:00",«start»
    "timeZone": "America/New_York"«start»
  },«start»
  "recurrence": [«repeat»
    "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"«repeat»
  ],«repeat»
  "conferenceData": {«link»
    "entryPoints": [{«link»
      "entryPointType": "video",«link»
      "uri": "https://meet.google.com/abc-defg-hij"«link»
    }]«link»
  }«link»
}`,
  },
  {
    name: 'Outlook',
    format: 'JSON',
    lang: 'json',
    conference: { provider: 'teams', joinUrl: 'https://teams.microsoft.com/l/...' },
    code: `
{
  "subject": "Standup",«title»
  "type": "seriesMaster",«repeat»
  "start": {«start»
    "dateTime": "2026-11-09T14:30:00.0000000",«start»
    "timeZone": "UTC"«start»
  },«start»
  "originalStartTimeZone": "Eastern Standard Time",«start»
  "recurrence": {«repeat»
    "pattern": {«repeat»
      "type": "weekly",«repeat»
      "interval": 1,«repeat»
      "daysOfWeek": [«repeat»
        "monday", "tuesday", "wednesday",«repeat»
        "thursday", "friday"«repeat»
      ]«repeat»
    },«repeat»
    "range": {«repeat»
      "type": "noEnd",«repeat»
      "startDate": "2026-11-09"«repeat»
    }«repeat»
  },«repeat»
  "onlineMeeting": {«link»
    "joinUrl": "https://teams.microsoft.com/l/..."«link»
  }«link»
}`,
  },
  {
    name: 'iCloud',
    format: 'iCalendar',
    lang: 'text',
    conference: { provider: 'google-meet', joinUrl: 'https://meet.google.com/abc-defg-hij' },
    code: `
BEGIN:VEVENT
UID:8C1F2A70-standup
SUMMARY:Standup«title»
DTSTART;TZID=America/New_York:20261109T093000«start»
DTEND;TZID=America/New_York:20261109T094500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR«repeat»
URL:https://meet.google.com/abc-defg-hij«link»
END:VEVENT`,
  },
  {
    name: 'Zoom',
    format: 'JSON',
    lang: 'json',
    conference: { provider: 'zoom', joinUrl: 'https://zoom.us/j/85512345678' },
    code: `
{
  "topic": "Standup",«title»
  "type": 8,
  "timezone": "America/New_York",«start»
  "recurrence": {«repeat»
    "type": 2,«repeat»
    "repeat_interval": 1,«repeat»
    "weekly_days": "2,3,4,5,6"«repeat»
  },«repeat»
  "occurrences": [«start»
    {«start»
      "start_time": "2026-11-09T14:30:00Z",«start»
      "duration": 15«start»
    },«start»
    {
      "start_time": "2026-11-10T14:30:00Z",
      "duration": 15
    }
  ],
  "join_url": "https://zoom.us/j/85512345678"«link»
}`,
  },
];

// The calsdk event each payload above becomes. Only the conference differs.
const eventCode = ({ provider, joinUrl }: { provider: string; joinUrl: string }) => `
{
  kind: 'series',
  title: 'Standup',«title»
  start: {«start»
    dateTime: '2026-11-09T09:30:00-05:00',«start»
    timeZone: 'America/New_York',«start»
  },«start»
  recurrence: [«repeat»
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',«repeat»
  ],«repeat»
  // From any Meet, Teams or Zoom link.
  conference: {«link»
    provider: '${provider}',«link»
    joinUrl: '${joinUrl}',«link»
  },«link»
  // Plus id, end, status and more.
}`;

const demoCode = (duration: number) => `
const { slots } = await findFreeTime({
  calendars: [
    { calendar: you },
    { calendar: sam },
  ],
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

const FEATURES = [
  {
    id: 'book',
    label: 'Book',
    title: 'Book a meeting, with the video link',
    points: [
      'createConference adds Google Meet on Google and Teams on Outlook work accounts.',
      'sendUpdates emails the guests, where the provider can.',
      'Anything the provider changed or ignored comes back in warnings.',
    ],
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
    label: 'Repeat',
    title: 'Recurring events are plain RRULEs',
    points: [
      'Listing expands a series, and each occurrence has its own id.',
      'Move one occurrence or the whole series. On Google, also everything after one.',
      'Outlook patterns and Zoom recurrence are converted to and from RRULEs.',
    ],
    code: `
const { event: series } = await createEvent({
  calendar,
  event: {
    title: 'Standup',
    start: { dateTime: '2026-11-09T09:30:00', timeZone: 'America/New_York' },
    end: { dateTime: '2026-11-09T09:45:00', timeZone: 'America/New_York' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  },
});

// Move only Friday's standup.
const friday = { timeMin: '2026-11-13', timeMax: '2026-11-14' };
for await (const event of iterateEvents({ calendar, ...friday })) {
  if (event.seriesId !== series.id) continue;
  await updateEvent({
    calendar,
    eventId: event.id,
    scope: 'this',
    patch: {
      start: { dateTime: '2026-11-13T10:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-13T10:15:00', timeZone: 'America/New_York' },
    },
  });
  break;
}`,
  },
  {
    id: 'sync',
    label: 'Sync',
    title: 'Keep a copy in your database',
    points: [
      'The first call returns what the provider syncs. Later calls return only changes.',
      'Changes are upserts and deletes, ready to apply.',
      'An expired cursor is its own error, so a full resync is one branch.',
    ],
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
  if (SyncCursorExpiredError.isInstance(error)) await db.clear();
  else throw error;
}`,
  },
  {
    id: 'typed',
    label: 'Types',
    title: 'Typed by the calendar you pass',
    points: [
      'Provider options are checked against the provider in calendar.',
      'Provider metadata comes back typed too.',
      'A misspelled option is a compile error, not a silent no-op.',
    ],
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
    title: 'Errors you can branch on',
    points: [
      'Conflicts, rate limits, auth and missing events each have a class.',
      'ifMatch updates only if nobody changed the event since you read it.',
      "A provider that can't do something warns or throws. It never quietly drops it.",
    ],
    code: `
import { ConflictError, RateLimitError, updateEvent } from 'calsdk';

try {
  await updateEvent({ calendar, eventId: event.id, ifMatch: event.etag, patch: { title } });
} catch (error) {
  if (ConflictError.isInstance(error)) return reloadAndAskAgain();
  if (RateLimitError.isInstance(error)) return retryLater();
  throw error;
}`,
  },
];

type Support = boolean | string;
const CAPABILITIES = ['Read', 'Write', 'Recurring', 'Adds video links', 'Sync'];
const SUPPORT: [name: string, pkg: string, support: Support[]][] = [
  ['Google Calendar', 'google', [true, true, true, 'Google Meet', true]],
  ['Microsoft Outlook', 'microsoft', [true, true, true, 'Teams', true]],
  ['iCloud', 'caldav', [true, true, true, false, true]],
  ['Zoho Calendar', 'caldav', [true, true, true, false, true]],
  ['Any CalDAV server', 'caldav', [true, true, true, false, true]],
  ['Zoom', 'zoom', [true, true, "Zoom's patterns", 'Zoom', true]],
  ['Cal.com', 'calcom', [true, 'Book, move, cancel', false, false, true]],
  ['Calendly', 'calendly', [true, 'Book, cancel', false, false, true]],
  ['ICS feeds', 'ics', [true, false, 'Read only', false, true]],
];

// What each API calls an event's title, as in the payloads above.
const TITLE_NAMES = [
  ['Google', 'summary'],
  ['Outlook', 'subject'],
  ['iCloud', 'SUMMARY:'],
  ['Zoom', 'topic'],
];

const STATS = [
  ['9', 'calendars'],
  ['1', 'event shape'],
  ['0', 'vendor SDKs'],
  ['4', 'runtimes: Node, Bun, Deno, edge'],
];

const PROVIDER_CODE = `
import type { CalendarProviderV1 } from '@calsdk/provider';

type Fastmail = CalendarProviderV1<'fastmail'>;

export function fastmail(settings: Settings): Fastmail {
  return {
    specificationVersion: 'v1',
    provider: 'fastmail',
    capabilities: { /* what it supports */ },
    async doListCalendars(options) { /* ... */ },
    // doGetEvent, doListEvents, doCreateEvent, ...
  };
}`;

const CONFORMANCE_CODE = `
import {
  describeProviderConformance,
} from '@calsdk/provider-tests';

describeProviderConformance({
  name: 'fastmail',
  createProvider: ({ fetch }) => fastmail({ token, fetch }),
  recording: {
    path: 'test/fixtures/conformance.json',
    mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
  },
});`;

export default async function HomePage() {
  const [providers, payloads, lengths, features, contractCode, conformanceCode] = await Promise.all(
    [
      Promise.all(
        PROVIDERS.map(async ({ id, label, pkg, color, setup }) => ({
          id,
          label,
          color,
          code: await highlightCode(providerCode(id, pkg, setup), { changed: [2, 4] }),
        })),
      ),
      Promise.all(
        PAYLOADS.map(async ({ name, format, lang, code, conference }) => ({
          name,
          format,
          code: await highlightCode(code, { lang }),
          result: await highlightCode(eventCode(conference)),
        })),
      ),
      Promise.all(
        [30, 60, 90].map(async (minutes) => ({
          minutes,
          code: await highlightCode(demoCode(minutes), { changed: [8] }),
        })),
      ),
      Promise.all(
        FEATURES.map(async ({ code, ...feature }) => ({
          ...feature,
          code: await highlightCode(code),
        })),
      ),
      highlightCode(PROVIDER_CODE),
      highlightCode(CONFORMANCE_CODE),
    ],
  );

  return (
    <div className="mx-auto w-full max-w-[1360px] border-x border-line">
      <section className="hero-grid relative overflow-hidden px-5 pt-16 pb-12 sm:px-10 sm:pt-28 sm:pb-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
          Calendar SDK for TypeScript
        </p>
        <div className="mt-6 grid items-end gap-10 lg:grid-cols-[1.35fr_1fr]">
          <h1 className="text-[clamp(3.25rem,10vw,5.75rem)] leading-[0.9] font-semibold tracking-[-0.055em] text-white">
            <span className="whitespace-nowrap">Every calendar.</span>
            <br />
            <span className="text-neutral-500">One API.</span>
          </h1>
          <div>
            <p className="text-lg leading-relaxed text-neutral-300">
              Read, write and sync events on Google, Outlook, iCloud, Zoom, Cal.com, Calendly and
              any CalDAV server. One set of typed functions, and a clear warning or error wherever a
              provider falls short.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/quickstart"
                className="flex h-11 items-center rounded-full bg-white px-6 text-sm font-medium text-black hover:bg-neutral-200"
              >
                Get started
              </Link>
              <a
                href={githubUrl}
                className="flex h-11 items-center rounded-full border border-line px-6 text-sm font-medium text-neutral-200 hover:border-neutral-500"
              >
                GitHub
              </a>
            </div>
            <div className="mt-4">
              <CopyCommand command="npm i calsdk @calsdk/google" />
            </div>
          </div>
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-2 font-mono text-sm sm:mt-16">
          {TITLE_NAMES.map(([provider, name], i) => (
            <span
              key={provider}
              style={{ animationDelay: `${300 + i * 120}ms` }}
              className="chip-in rounded-md border border-line bg-panel px-2.5 py-1.5"
            >
              <span className="font-sans text-neutral-500">{provider}</span>{' '}
              <span className="text-neutral-300">{name}</span>
            </span>
          ))}
          <span className="flex items-center gap-2">
            <ArrowRight aria-hidden className="mx-1 size-4 text-neutral-500" />
            <span
              style={{ animationDelay: '840ms' }}
              className="chip-in rounded-md border border-accent-blue/60 bg-accent-blue/10 px-2.5 py-1.5"
            >
              <span className="font-sans text-neutral-400">calsdk</span>{' '}
              <span className="text-white">title</span>
            </span>
          </span>
        </div>
      </section>

      <ProviderShowcase providers={providers} />

      <div className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
        {STATS.map(([value, label]) => (
          <div
            key={label}
            className="border-line px-5 py-8 sm:px-10 odd:border-r lg:border-r lg:last:border-r-0 [&:nth-child(-n+2)]:border-b lg:[&:nth-child(-n+2)]:border-b-0"
          >
            <div className="text-5xl font-semibold tracking-[-0.04em] text-white">{value}</div>
            <div className="mt-2 text-sm text-neutral-400">{label}</div>
          </div>
        ))}
      </div>

      <Section
        id="why"
        index="01"
        eyebrow="The problem"
        title="Four APIs, four ways to write one standup"
      >
        <FieldCompare payloads={payloads} />
      </Section>

      <Section
        id="demo"
        index="02"
        eyebrow="Live"
        title="Find a time that works for both"
        intro="This is the real findFreeTime, running in your browser on two in-memory calendars. Book a slot and both calendars update."
      >
        <FreeTimeDemo lengths={lengths} />
      </Section>

      <Section
        id="time-zones"
        index="03"
        eyebrow="Time zones"
        title="Clocks change. Your standup shouldn't."
        intro="A weekly 9:30 standup in New York, through March 2027. The US moves its clocks on the 14th, Europe on the 28th."
      >
        <ClockChange />
        <p className="mt-5 max-w-3xl text-sm text-neutral-400">
          calsdk keeps the time and the zone, so the series is expanded in New York time. Berlin
          sees it an hour early for the two weeks Europe hasn't changed yet, which is right: the
          meeting belongs to New York.
        </p>
      </Section>

      <section id="features" className="scroll-mt-20 border-t border-line">
        <SectionHeading
          index="04"
          eyebrow="Features"
          title="The calendar code you'd rather not write"
        />
        <FeatureTabs features={features} />
      </section>

      <Section id="providers" index="05" eyebrow="Providers" title="Nine calendars today">
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {SUPPORT.map(([name, pkg, support]) => (
            <div key={name} className="bg-fd-background p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{name}</h3>
                <span className="font-mono text-xs text-neutral-400">@calsdk/{pkg}</span>
              </div>
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm sm:mt-5 sm:block sm:space-y-2">
                {CAPABILITIES.map((capability, i) => (
                  <Capability key={capability} label={capability} value={support[i] ?? false} />
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-neutral-400">
          Free/busy and findFreeTime work on every provider, and across providers. Google, Outlook,
          Zoho, Zoom, Cal.com and Calendly are tested against their real APIs, and the recordings
          replay in CI.
        </p>
      </Section>

      <Section
        id="your-provider"
        index="06"
        eyebrow="Extend"
        title="Bring your own calendar"
        intro="A provider is one object with a few functions. Test it with the conformance suite most official providers run."
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

      <section className="hero-grid relative flex flex-col items-center overflow-hidden border-t border-line px-5 py-24 text-center sm:py-32">
        <Mark className="size-14 text-white" />
        <h2 className="mt-8 max-w-3xl text-balance text-[clamp(2.5rem,7vw,5rem)] leading-[0.95] font-semibold tracking-[-0.05em] text-white">
          Try it without an account
        </h2>
        <p className="mt-5 max-w-md text-neutral-400">
          The mock provider is a real calendar in memory. Swap in Google or Outlook when you're
          ready.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <CopyCommand command="npm i calsdk @calsdk/mock" />
          <Link
            href="/docs/quickstart"
            className="flex h-11 items-center rounded-full bg-white px-6 text-sm font-medium text-black hover:bg-neutral-200"
          >
            Read the quickstart
          </Link>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-8 text-sm text-neutral-500 sm:px-10">
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
    </div>
  );
}

function SectionHeading({
  index,
  eyebrow,
  title,
  intro,
}: {
  index: string;
  eyebrow: string;
  title: string;
  intro?: string;
}) {
  return (
    <div className="px-5 pt-16 pb-8 sm:px-10 sm:pt-24 sm:pb-10">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
        <span className="text-accent-blue">{index}</span> / {eyebrow}
      </p>
      <h2 className="mt-4 max-w-4xl text-balance text-4xl leading-[1.02] font-semibold tracking-[-0.045em] text-white sm:text-6xl">
        {title}
      </h2>
      {intro && <p className="mt-5 max-w-2xl text-lg text-neutral-400">{intro}</p>}
    </div>
  );
}

function Section({
  id,
  children,
  ...heading
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line">
      <SectionHeading {...heading} />
      <div className="px-5 pb-16 sm:px-10 sm:pb-24">{children}</div>
    </section>
  );
}

function Capability({ label, value }: { label: string; value: Support }) {
  return (
    <li className="flex items-center gap-2 sm:gap-3">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${
          value === false ? 'border border-neutral-700' : 'bg-accent-blue'
        }`}
      />
      <span className={value === false ? 'text-neutral-600' : 'text-neutral-200'}>
        {label}
        <span className="sr-only">{value === false ? ', not supported' : ', supported'}</span>
      </span>
      {typeof value === 'string' && (
        <span className="text-xs text-neutral-400 sm:ml-auto sm:text-right">{value}</span>
      )}
    </li>
  );
}
