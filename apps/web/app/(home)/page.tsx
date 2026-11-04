import { ArrowRight, FlaskConical, Globe, type LucideIcon, Plug, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarApp } from '@/components/landing/calendar-app';
import { highlightCode } from '@/components/landing/code';
import { CopyCommand } from '@/components/landing/copy-command';
import { FeatureTabs } from '@/components/landing/feature-tabs';
import { ProviderShowcase } from '@/components/landing/provider-showcase';
import { Mark } from '@/components/logo';
import { githubUrl } from '@/lib/shared';

type Support = boolean | string;
const CAPABILITIES = ['Read', 'Write', 'Recurring', 'Video links', 'Sync'];

// `support` follows CAPABILITIES: true, false, or a note on how far it goes.
const PROVIDERS: {
  id: string;
  label: string;
  pkg: string;
  color: string;
  setup: string;
  support: Support[];
}[] = [
  {
    id: 'google',
    label: 'Google',
    pkg: 'google',
    color: '#7aa7ff',
    setup: 'google({ accessToken })',
    support: [true, true, true, 'Google Meet', true],
  },
  {
    id: 'microsoft',
    label: 'Outlook',
    pkg: 'microsoft',
    color: '#37c5d9',
    setup: 'microsoft({\n  accessToken,\n})',
    support: [true, true, true, 'Teams, work accounts', true],
  },
  {
    id: 'icloud',
    label: 'iCloud',
    pkg: 'caldav',
    color: '#ff7a70',
    setup: 'icloud({\n  appleId,\n  appPassword,\n})',
    support: [true, true, true, false, true],
  },
  {
    id: 'zoho',
    label: 'Zoho',
    pkg: 'caldav',
    color: '#f0883e',
    setup: 'zoho({\n  email,\n  password,\n})',
    support: [true, true, true, false, true],
  },
  {
    id: 'caldav',
    label: 'CalDAV',
    pkg: 'caldav',
    color: '#a1a1aa',
    setup: 'caldav({\n  serverUrl,\n  username,\n  password,\n})',
    support: [true, true, true, false, true],
  },
  {
    id: 'zoom',
    label: 'Zoom',
    pkg: 'zoom',
    color: '#b392f0',
    setup: 'zoom({ accessToken })',
    support: [true, true, "Zoom's patterns", 'Zoom', true],
  },
  {
    id: 'calcom',
    label: 'Cal.com',
    pkg: 'calcom',
    color: '#e4e4e7',
    setup: 'calcom({ accessToken })',
    support: [true, 'book an event type, move, cancel', false, false, true],
  },
  {
    id: 'calendly',
    label: 'Calendly',
    pkg: 'calendly',
    color: '#f5b94a',
    setup: 'calendly({\n  accessToken,\n})',
    support: [true, 'book an event type, cancel', false, false, true],
  },
  {
    id: 'ics',
    label: 'ICS feed',
    pkg: 'ics',
    color: '#5ee08f',
    setup: 'ics({ url: feedUrl })',
    support: [true, false, 'read only', false, true],
  },
];

// Lines are kept to about 40 characters so the code fits a phone without scrolling.
function providerCode(id: string, pkg: string, setup: string) {
  const short = `import { ${id} } from '@calsdk/${pkg}';`;
  const provider = (
    short.length > 41 ? `import {\n  ${id},\n} from '@calsdk/${pkg}';` : short
  ).split('\n');
  const calendar = `const calendar = ${setup};`.split('\n');
  const code = ["import { listEvents } from 'calsdk';", ...provider, '', ...calendar].join('\n');
  // Highlighted lines are 1-based: the provider import, then the calendar after a blank line.
  const changed = [
    ...provider.map((_, i) => 2 + i),
    ...calendar.map((_, i) => 3 + provider.length + i),
  ];
  return {
    changed,
    code: `${code}

const { events } = await listEvents({
  calendar,
  timeMin: '2026-11-01T00:00:00Z',
  timeMax: '2026-12-01T00:00:00Z',
});

for (const event of events) {
  console.log(
    event.title,
    event.start,
    event.conference?.joinUrl,
  );
}`,
  };
}

const FEATURES = [
  {
    id: 'book',
    label: 'Book',
    title: 'Book a meeting, with the video link',
    body: 'Create a meeting with a Google Meet or Teams link. Provider changes come back as warnings.',
    code: `
import { createEvent } from 'calsdk';

const result = await createEvent({
  calendar,
  event: {
    title: 'Intro call',
    start: {
      dateTime: '2026-11-12T15:00:00',
      timeZone: 'Europe/Berlin',
    },
    end: {
      dateTime: '2026-11-12T15:30:00',
      timeZone: 'Europe/Berlin',
    },
    attendees: [
      { email: 'guest@example.com' },
    ],
    createConference: true,
  },
  sendUpdates: 'all',
});

result.event.conference?.joinUrl;
// Anything the provider changed:
result.warnings;`,
  },
  {
    id: 'recurring',
    label: 'Repeat',
    title: 'Move one meeting in a series',
    body: 'Listing expands a series into occurrences, each with its own id. Move one, or the whole series.',
    code: `
import {
  listEvents,
  updateEvent,
} from 'calsdk';

// Listing expands the weekday standup.
const { events } = await listEvents({
  calendar,
  timeMin: '2026-11-13',
  timeMax: '2026-11-14',
});
const friday = events.find(
  (event) => event.title === 'Standup',
);

// Move only Friday's, to 10:00.
if (friday) {
  await updateEvent({
    calendar,
    eventId: friday.id,
    scope: 'this',
    patch: {
      start: {
        dateTime: '2026-11-13T10:00:00',
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: '2026-11-13T10:15:00',
        timeZone: 'America/New_York',
      },
    },
  });
}`,
  },
  {
    id: 'sync',
    label: 'Sync',
    title: 'Keep a copy in your database',
    body: 'Later calls return only what changed. An expired cursor is its own error, so a full resync is one branch.',
    code: `
import {
  SyncCursorExpiredError,
  syncEvents,
} from 'calsdk';

async function sync(cursor?: string) {
  const result = await syncEvents({
    calendar,
    cursor,
  });
  for (const change of result.changes) {
    if (change.type === 'delete') {
      await db.remove(change.eventId);
    } else {
      await db.save(change.event);
    }
  }
  await db.saveCursor(result.nextCursor);
}

try {
  await sync(await db.cursor());
} catch (error) {
  if (!SyncCursorExpiredError.isInstance(error)) {
    throw error;
  }
  // Expired: drop the copy, start over.
  await db.clear();
  await sync();
}`,
  },
  {
    id: 'typed',
    label: 'Types',
    title: 'Typed by the calendar you pass',
    body: 'Provider options are checked against the calendar you pass, so a typo fails to compile.',
    code: `
const calendar = google({ accessToken });

await createEvent({
  calendar,
  event,
  providerOptions: {
    google: { guestsCanModify: true },
  },
});

// Type error: misspelled option.
await createEvent({
  calendar,
  event,
  providerOptions: {
    google: { guestsCanModfy: true },
  },
});

const { event: created } = await createEvent({
  calendar,
  event,
});
// string | undefined
created.providerMetadata?.google?.iCalUID;`,
  },
  {
    id: 'errors',
    label: 'Errors',
    title: 'Errors you can branch on',
    body: 'Conflicts, rate limits, auth and missing events each have their own error class.',
    code: `
import {
  ConflictError,
  RateLimitError,
  updateEvent,
} from 'calsdk';

try {
  await updateEvent({
    calendar,
    eventId: event.id,
    // Only if nobody edited it since.
    ifMatch: event.etag,
    patch: { title },
  });
} catch (error) {
  if (ConflictError.isInstance(error)) {
    return reloadAndAskAgain();
  }
  if (RateLimitError.isInstance(error)) {
    return retryLater();
  }
  throw error;
}`,
  },
];

// The weekday standup's recurrence, as Outlook stores it.
const OUTLOOK_PATTERN = `"pattern": {
  "type": "weekly",
  "daysOfWeek": ["monday", "tuesday",
    "wednesday", "thursday", "friday"]
}`;

// A weekly 9:30 New York standup seen from Berlin in March 2027. The US changes its clocks on
// March 14, Europe on March 28.
const BERLIN = [
  ['Mon, Mar 8', '15:30', false],
  ['Mon, Mar 15', '14:30', true],
  ['Mon, Mar 22', '14:30', true],
  ['Mon, Mar 29', '15:30', false],
] as const;

const EXTRAS: { icon: LucideIcon; title: string; body: ReactNode }[] = [
  {
    icon: Globe,
    title: 'Runs anywhere',
    body: 'Only fetch, no vendor SDKs. Node, Bun, Deno and edge runtimes.',
  },
  {
    icon: FlaskConical,
    title: 'A calendar for tests',
    body: (
      <>
        <code className="font-mono text-[0.9em] text-neutral-300">@calsdk/mock</code> keeps a real
        calendar in memory. The demo at the top runs on it.
      </>
    ),
  },
  {
    icon: ShieldCheck,
    title: 'Tested on the real APIs',
    body: 'Google, Outlook, Zoho, Zoom, Cal.com and Calendly are recorded live and replayed in CI.',
  },
  {
    icon: Plug,
    title: 'Bring your own provider',
    body: 'A provider is one object with a few functions, checked by the conformance suite.',
  },
];

export default async function HomePage() {
  const [providers, features] = await Promise.all([
    Promise.all(
      PROVIDERS.map(async ({ id, label, pkg, color, setup, support }) => {
        const { code, changed } = providerCode(id, pkg, setup);
        return {
          id,
          label,
          pkg: `@calsdk/${pkg}`,
          color,
          code: await highlightCode(code, { changed }),
          support: CAPABILITIES.map((capability, i): [string, Support] => [
            capability,
            support[i] ?? false,
          ]),
        };
      }),
    ),
    Promise.all(
      FEATURES.map(async ({ code, ...feature }) => ({
        ...feature,
        code: await highlightCode(code),
      })),
    ),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 sm:px-8">
      <section className="flex flex-col items-center pt-14 text-center sm:pt-20">
        <h1 className="text-balance text-[clamp(3rem,9vw,5.5rem)] leading-[0.92] font-semibold tracking-[-0.045em] text-white">
          Every calendar.
          <br />
          One API.
        </h1>
        <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-neutral-400">
          Read, write and sync events on Google, Outlook, iCloud and six other providers, with one
          typed TypeScript API.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/quickstart"
            className="flex h-11 items-center rounded-lg bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200"
          >
            Get started
          </Link>
          <CopyCommand command="npm i calsdk @calsdk/mock" />
        </div>
      </section>

      <section className="mt-12 sm:mt-16 xl:-mx-10 2xl:-mx-40" aria-label="Live demo">
        <CalendarApp />
        <p className="mt-4 text-center text-sm text-neutral-500">
          Running in your browser: six sample calendars in memory, with the real listEvents,
          findFreeTime and createEvent.
        </p>
      </section>

      <Section
        title="Switch calendars, not code"
        aside="Pick a provider. Two lines change, and the events come back in the same shape."
        link={{ href: '/docs/choose-a-provider', label: 'Choose a provider' }}
      >
        <ProviderShowcase providers={providers} />
      </Section>

      <Section
        title={
          <>
            <span className="block">The quirks are handled.</span>
            <span className="block">The rest is reported.</span>
          </>
        }
        aside="Recurrence, time zones and field names are converted for you. When a provider can't do what you asked, the result says so."
        link={{ href: '/docs/concepts/warnings', label: 'How warnings work' }}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Card
            title="Recurrence is always an RRULE"
            body="Outlook stores a pattern object and Zoom numbers its weekdays. You read and write one RRULE."
          >
            <div className="font-mono text-xs leading-relaxed">
              <pre className="text-neutral-400">{OUTLOOK_PATTERN}</pre>
              <ArrowRight aria-hidden className="my-2 size-3.5 rotate-90 text-neutral-600" />
              <p className="break-all text-[#a5d6ff]">'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'</p>
            </div>
          </Card>
          <Card
            title="Warnings, not silent changes"
            body="Google has a fixed palette. Your color is saved as the nearest one, and the result says so."
          >
            <div className="font-mono text-xs leading-relaxed">
              <p className="text-neutral-400">
                color: <span className="text-[#a5d6ff]">'#ec4899'</span>
              </p>
              <div className="mt-3 flex items-center gap-2 text-neutral-400">
                <Swatch color="#ec4899" label="asked" />
                <ArrowRight aria-hidden className="size-3.5 text-neutral-600" />
                <Swatch color="#e67c73" label="saved" />
              </div>
              <p className="mt-3 text-neutral-300">
                warnings: [{'{'}{' '}
                <span className="whitespace-nowrap">
                  type: <span className="text-[#a5d6ff]">'compatibility'</span>,
                </span>{' '}
                <span className="whitespace-nowrap">
                  feature: <span className="text-[#a5d6ff]">'color'</span> {'}'}]
                </span>
              </p>
            </div>
          </Card>
          <Card
            title="Time zones that survive clock changes"
            body="The standup stays at 9:30 in New York. Berlin sees it an hour early until Europe changes its clocks too."
          >
            <div className="text-xs">
              <p className="mb-2 text-neutral-400">9:30 New York standup, in Berlin, March 2027</p>
              {BERLIN.map(([date, time, early]) => (
                <div
                  key={date}
                  className="flex items-center justify-between border-t border-line py-1.5"
                >
                  <span className="text-neutral-400">{date}</span>
                  <span className={`font-mono ${early ? 'text-accent-blue' : 'text-neutral-200'}`}>
                    {time}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      <Section
        title="The calendar code you'd rather not write"
        link={{ href: '/docs/guides/write-events', label: 'Read the guides' }}
      >
        <FeatureTabs features={features} />
      </Section>

      <section className="mt-24 grid gap-x-10 gap-y-10 border-t border-line pt-16 sm:mt-32 sm:grid-cols-2 lg:grid-cols-4">
        {EXTRAS.map(({ icon: Icon, title, body }) => (
          <div key={title}>
            <Icon aria-hidden className="size-5 text-neutral-300" strokeWidth={1.75} />
            <h3 className="mt-4 font-medium text-white">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-24 flex flex-col items-center border-t border-line py-24 text-center sm:mt-32 sm:py-32">
        <Mark className="size-12 text-white" />
        <h2 className="mt-8 max-w-2xl text-balance text-[clamp(2.25rem,6vw,4rem)] leading-[0.98] font-semibold tracking-[-0.05em] text-white">
          Try it without connecting a calendar
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/quickstart"
            className="flex h-11 items-center rounded-lg bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200"
          >
            Read the quickstart
          </Link>
          <CopyCommand command="npm i calsdk @calsdk/mock" />
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-6 text-sm text-neutral-500">
        <span>MIT License</span>
        <div className="flex gap-5">
          <Link
            href="/docs"
            className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-white"
          >
            Docs
          </Link>
          <a
            href={githubUrl}
            className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-white"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

function Section({
  title,
  aside,
  link,
  children,
}: {
  title: ReactNode;
  aside?: string;
  link: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="mt-24 sm:mt-36">
      <div className="mb-10 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-16">
        <h2 className="max-w-2xl text-balance text-[2rem] leading-[1.02] font-semibold tracking-[-0.045em] text-white sm:text-5xl">
          {title}
        </h2>
        <div className="lg:max-w-sm">
          {aside && <p className="leading-relaxed text-neutral-400">{aside}</p>}
          <Link
            href={link.href}
            className={`inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-white hover:text-neutral-300 ${aside ? 'mt-1' : ''}`}
          >
            {link.label}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </div>
      {children}
    </section>
  );
}

function Card({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex min-h-44 flex-1 items-center border-b border-line px-6 py-6">
        <div className="w-full">{children}</div>
      </div>
      <div className="p-6">
        <h3 className="font-medium text-white">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{body}</p>
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-4 rounded" style={{ background: color }} />
      {color} {label}
    </span>
  );
}
