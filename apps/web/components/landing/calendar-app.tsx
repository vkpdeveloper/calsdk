'use client';

import { type MockCalendarProvider, mockCalendar } from '@calsdk/mock';
import { createEvent, type EventOf, type FreeSlot, findFreeTime, listEvents } from 'calsdk';
import { Plus } from 'lucide-react';
import { type ReactNode, type Ref, useCallback, useEffect, useRef, useState } from 'react';

// A fixed week, so New York stays on one offset and every visitor sees the same calendar.
const ZONE = 'America/New_York';
const OFFSET = '-05:00';
const DAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_DATES = [9, 10, 11, 12, 13];
const OPEN = 9;
const CLOSE = 18;
const HOURS = Array.from({ length: CLOSE - OPEN }, (_, i) => OPEN + i);
// Rows are sized by the --hour CSS variable, shorter on phones.
const hours = (n: number) => `calc(var(--hour) * ${n})`;
const RANGE = { timeMin: `${DAYS[0]}T00:00:00${OFFSET}`, timeMax: `2026-11-14T00:00:00${OFFSET}` };

type Seed = [day: number, start: string, end: string, title: string];

// Six sample calendars. `field` is what that provider's own API calls an event's title.
const SOURCES = [
  {
    id: 'google',
    name: 'Google Calendar',
    short: 'Google',
    field: 'summary',
    color: '#7aa7ff',
    seeds: [
      [0, '13:00', '14:00', 'Design review'],
      [2, '15:00', '17:00', 'Focus time'],
    ],
  },
  {
    id: 'outlook',
    name: 'Outlook',
    short: 'Outlook',
    field: 'subject',
    color: '#37c5d9',
    seeds: [
      [0, '15:00', '15:30', '1:1'],
      [1, '14:00', '15:30', 'Sprint planning'],
      [2, '10:00', '11:30', 'Quarterly review'],
    ],
  },
  {
    id: 'icloud',
    name: 'iCloud',
    short: 'iCloud',
    field: 'SUMMARY',
    color: '#ff7a70',
    seeds: [
      [1, '12:30', '13:30', 'Lunch with Sam'],
      [3, '16:00', '17:00', 'Dentist'],
      [4, '12:00', '13:30', 'Team lunch'],
    ],
  },
  {
    id: 'zoom',
    name: 'Zoom',
    short: 'Zoom',
    field: 'topic',
    color: '#b392f0',
    seeds: [
      [1, '11:00', '12:00', 'Customer demo'],
      [3, '10:00', '10:45', 'Investor update'],
      [4, '15:00', '16:00', 'Retro'],
    ],
  },
  {
    id: 'calcom',
    name: 'Cal.com',
    short: 'Cal.com',
    field: 'title',
    color: '#e4e4e7',
    seeds: [
      [2, '13:00', '13:30', 'Intro call'],
      [4, '10:00', '10:30', 'Intro call'],
    ],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    short: 'Calendly',
    field: 'name',
    color: '#f5b94a',
    seeds: [
      [0, '11:00', '11:30', 'Discovery call'],
      [3, '14:00', '14:30', 'Discovery call'],
    ],
  },
] satisfies {
  id: string;
  name: string;
  short: string;
  field: string;
  color: string;
  seeds: Seed[];
}[];

type Source = (typeof SOURCES)[number];
type SourceId = Source['id'];

const at = (day: number, time: string) => ({
  dateTime: `${DAYS[day]}T${time}:00${OFFSET}`,
  timeZone: ZONE,
});

function createCalendars() {
  return Object.fromEntries(
    SOURCES.map((source) => [
      source.id,
      mockCalendar({
        events: [
          ...source.seeds.map(([day, start, end, title]) => ({
            title,
            start: at(day, start),
            end: at(day, end),
          })),
          // Google also holds the weekday standup, so the week shows a recurring series.
          ...(source.id === 'google'
            ? [
                {
                  title: 'Standup',
                  start: at(0, '09:30'),
                  end: at(0, '09:45'),
                  recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
                },
              ]
            : []),
        ],
      }),
    ]),
  ) as Record<SourceId, MockCalendarProvider>;
}

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** The day column and minutes after midnight of an instant, in New York. */
function place(instant: string) {
  const parts = Object.fromEntries(
    wallClock.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  return {
    day: DAYS.indexOf(`${parts.year}-${parts.month}-${parts.day}`),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

type Placed = { day: number; from: number; to: number };

function span(start: string, end: string): Placed {
  const a = place(start);
  return { day: a.day, from: a.minutes, to: place(end).minutes };
}

/** Joins the overlapping slots of a day into ranges, each starting at its first slot. */
function freeRanges(slots: FreeSlot[]) {
  const ranges: (Placed & { first: FreeSlot })[] = [];
  for (const slot of slots) {
    const block = span(slot.start, slot.end);
    const last = ranges.at(-1);
    if (last && last.day === block.day && block.from <= last.to) last.to = block.to;
    else ranges.push({ ...block, first: slot });
  }
  return ranges;
}

type Listed = { event: EventOf<MockCalendarProvider>; source: Source; key: string; at: Placed };
type Free = Placed & { first: FreeSlot };
type Run = { events: Listed[]; free?: Free[]; ms: number };

/** A week of six calendars, read with the real listEvents and findFreeTime in the browser. */
export function CalendarApp() {
  const [calendars, setCalendars] = useState(createCalendars);
  const [enabled, setEnabled] = useState<SourceId[]>(SOURCES.map((source) => source.id));
  const [finding, setFinding] = useState(false);
  const [run, setRun] = useState<Run>();
  const [selected, setSelected] = useState<string>();
  const [booked, setBooked] = useState<string>();
  // The day the phone agenda shows.
  const [day, setDay] = useState(0);
  const inspector = useRef<HTMLDivElement>(null);

  // Below 1024px the event panel sits under the calendar, so bring it into view.
  function pick(key: string) {
    setSelected(key);
    if (!matchMedia('(max-width: 1023px)').matches) return;
    requestAnimationFrame(() =>
      inspector.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }

  const sources = SOURCES.filter((source) => enabled.includes(source.id));
  // New meetings go to the first calendar that is turned on, so they always show up.
  const target = sources[0];
  const searching = finding && target !== undefined;

  const refresh = useCallback(async () => {
    const shown = SOURCES.filter((source) => enabled.includes(source.id));
    const started = performance.now();
    const lists = await Promise.all(
      shown.map(async (source) => {
        const { events } = await listEvents({ calendar: calendars[source.id], ...RANGE });
        return events.flatMap((event) =>
          event.start.dateTime && event.end.dateTime
            ? [
                {
                  event,
                  source,
                  key: `${source.id}:${event.id}`,
                  at: span(event.start.dateTime, event.end.dateTime),
                },
              ]
            : [],
        );
      }),
    );
    const free =
      finding && shown.length > 0
        ? freeRanges(
            (
              await findFreeTime({
                calendars: shown.map((source) => ({ calendar: calendars[source.id] })),
                ...RANGE,
                duration: 60,
                slotInterval: 30,
                workingHours: { start: '09:00', end: '18:00', timeZone: ZONE },
              })
            ).slots,
          )
        : undefined;
    const events = lists.flat().sort((a, b) => a.at.day - b.at.day || a.at.from - b.at.from);
    setRun({ events, free, ms: performance.now() - started });
  }, [calendars, enabled, finding]);

  useEffect(() => {
    // The mock notes that it computes free/busy from events. That is expected here.
    globalThis.CALSDK_WARNINGS = 'silent';
    void refresh();
  }, [refresh]);

  // With nothing picked, or the picked event's calendar turned off, open the day's standup:
  // an occurrence of a series says the most. The day only changes on phones (or by
  // booking), so desktop starts on Monday's.
  const onDay = run?.events.filter((listed) => listed.at.day === day) ?? [];
  const current =
    run?.events.find((listed) => listed.key === selected) ??
    onDay.find((listed) => listed.event.kind === 'occurrence') ??
    onDay[0];

  // A new day on the phone agenda keeps the open event only if it is on that day.
  function showDay(next: number) {
    setDay(next);
    if (current?.at.day !== next) setSelected(undefined);
  }

  async function book(slot: FreeSlot) {
    if (!target) return;
    // findFreeTime returns UTC instants. Book in New York time, like the other events.
    const { day: slotDay, from, to } = span(slot.start, slot.end);
    const { event } = await createEvent({
      calendar: calendars[target.id],
      event: {
        title: 'New meeting',
        start: at(slotDay, clock(from)),
        end: at(slotDay, clock(to)),
      },
    });
    setBooked(`Booked ${DAY_NAMES[slotDay]} ${clock(from)} on ${target.name}.`);
    pick(`${target.id}:${event.id}`);
    setDay(slotDay);
    // A new calendars object reruns the listing with the booking in it.
    setCalendars({ ...calendars });
  }

  function toggle(id: SourceId) {
    setBooked(undefined);
    setEnabled((ids) => (ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id]));
  }

  function reset() {
    setCalendars(createCalendars());
    setEnabled(SOURCES.map((source) => source.id));
    setFinding(false);
    setSelected(undefined);
    setBooked(undefined);
    setDay(0);
  }

  const bookLabel = (range: Free) =>
    `Book ${DAY_NAMES[range.day]} ${clock(range.from)} to ${clock(range.from + 60)} on ${target?.name}`;

  let message: ReactNode = booked;
  if (!message && finding && !target) message = 'Turn on a calendar to find free time.';
  if (!message && run) {
    // Phones drop the function names, so the line fits.
    message = (
      <>
        <span className="hidden sm:inline">
          {searching ? 'listEvents + findFreeTime' : 'listEvents'} ·{' '}
        </span>
        <span className="whitespace-nowrap">
          {sources.length} <span className="max-sm:hidden">sample </span>calendars
        </span>{' '}
        · <span className="whitespace-nowrap">{run.events.length} events</span>
        {/* The timing drops below 375px, so the line stays on one row. */}
        <span className="whitespace-nowrap max-[374px]:hidden"> · {run.ms.toFixed(1)} ms</span>
      </>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#0c0c0e] text-left shadow-[0_40px_120px_-40px_rgb(0_0_0/0.9)]">
      <div className="flex h-14 items-center gap-3 border-b border-line px-4">
        <span aria-hidden className="hidden gap-1.5 sm:flex">
          <span className="size-3 rounded-full bg-neutral-700" />
          <span className="size-3 rounded-full bg-neutral-700" />
          <span className="size-3 rounded-full bg-neutral-700" />
        </span>
        <span className="text-sm font-medium whitespace-nowrap text-white sm:ml-4">
          <span className="sm:hidden">Nov 9 – 13</span>
          <span className="max-sm:hidden">November 9 – 13, 2026</span>
        </span>
        <span className="text-xs whitespace-nowrap text-neutral-500">
          New York<span className="max-sm:hidden"> time</span>
        </span>
        <button
          type="button"
          aria-pressed={finding}
          onClick={() => {
            setBooked(undefined);
            setFinding((on) => !on);
          }}
          className="ml-auto flex h-11 shrink-0 items-center rounded-lg border border-line px-3 text-sm text-neutral-200 hover:border-neutral-500 aria-pressed:border-accent-blue aria-pressed:bg-accent-blue/15 aria-pressed:text-white md:h-9"
        >
          Find a free hour
        </button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[10.5rem_minmax(0,1fr)_21rem]">
        {/* Below xl the calendars sit in a row on top, so the week gets the full width. */}
        <fieldset className="min-w-0 border-b border-line lg:col-span-2 xl:col-span-1 xl:border-b-0 xl:border-r">
          <legend className="sr-only">Calendars</legend>
          <p className="hidden px-4 pt-4 pb-2 text-xs font-medium text-neutral-500 xl:block">
            Sample calendars
          </p>
          {/* Phones get two rows of three, so all six are visible. */}
          <div className="grid grid-cols-3 gap-1 p-2 md:flex xl:flex-col xl:pt-0">
            {SOURCES.map((source) => {
              const on = enabled.includes(source.id);
              return (
                <button
                  key={source.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(source.id)}
                  className="flex h-11 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-neutral-500 hover:bg-white/[0.04] aria-pressed:text-neutral-200 md:h-9"
                >
                  <span
                    aria-hidden
                    className="size-3.5 shrink-0 rounded border-2"
                    style={{ borderColor: source.color, background: on ? source.color : undefined }}
                  />
                  {source.short}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Phones: one day at a time, as a list. */}
        <div className="md:hidden">
          <fieldset className="grid grid-cols-5 border-b border-line">
            <legend className="sr-only">Day</legend>
            {DAY_NAMES.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-pressed={i === day}
                onClick={() => showDay(i)}
                className="flex h-12 items-center justify-center gap-1 text-xs text-neutral-500 aria-pressed:bg-white/[0.06] aria-pressed:text-white"
              >
                {name}
                <span className="font-medium">{DAY_DATES[i]}</span>
              </button>
            ))}
          </fieldset>
          <ul className="flex flex-col gap-1 p-2">
            {agenda(run, day).map((item) =>
              'event' in item ? (
                <li key={item.key}>
                  <button
                    type="button"
                    aria-pressed={item.key === current?.key}
                    onClick={() => pick(item.key)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm aria-pressed:bg-white/[0.06]"
                  >
                    <span className="w-[5.5rem] shrink-0 font-mono text-[11px] text-neutral-400">
                      {clock(item.at.from)} – {clock(item.at.to)}
                    </span>
                    <span
                      aria-hidden
                      className="h-5 w-0.5 shrink-0 rounded-full"
                      style={{ background: item.source.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-white">{item.event.title}</span>
                    <span className="shrink-0 text-xs text-neutral-500">{item.source.short}</span>
                  </button>
                </li>
              ) : (
                <li key={`free-${item.from}`}>
                  <button
                    type="button"
                    aria-label={bookLabel(item)}
                    onClick={() => void book(item.first)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-dashed border-accent-blue/70 bg-accent-blue/10 px-2 py-2 text-left text-sm"
                  >
                    <span className="w-[5.5rem] shrink-0 font-mono text-[11px] text-neutral-400">
                      {clock(item.from)} – {clock(item.to)}
                    </span>
                    <span className="flex-1 text-neutral-300">Free</span>
                    <span className="shrink-0 font-medium text-white">Book {clock(item.from)}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </div>

        <div className="x-scroll hidden min-w-0 overflow-x-auto md:block">
          <div className="grid min-w-[540px] grid-cols-[3rem_repeat(5,minmax(0,1fr))] pr-2 pb-3 [--hour:56px]">
            <div className="sticky left-0 z-10 bg-[#0c0c0e]" />
            {DAY_NAMES.map((name, i) => (
              <div key={name} className="flex items-baseline justify-center gap-1.5 py-3 text-xs">
                <span className="text-neutral-500">{name}</span>
                <span className="font-medium text-neutral-200">{DAY_DATES[i]}</span>
              </div>
            ))}
            <div
              className="sticky left-0 z-10 bg-[#0c0c0e]"
              style={{ height: hours(CLOSE - OPEN) }}
            >
              {[...HOURS, CLOSE].map((hour) => (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-neutral-500"
                  style={{ top: hours(hour - OPEN) }}
                >
                  {clock(hour * 60)}
                </span>
              ))}
            </div>
            {DAYS.map((date, column) => (
              <div
                key={date}
                className="relative border-l border-line"
                style={{ height: hours(CLOSE - OPEN) }}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-[#1a1a1e]"
                    style={{ top: hours(hour - OPEN) }}
                  />
                ))}
                {/* Free time is shading. A pill at its top books its first hour. */}
                {run?.free
                  ?.filter((range) => range.day === column)
                  .map((range) => (
                    <div
                      key={`free-${range.from}`}
                      className="absolute inset-x-1 rounded-md border border-dashed border-accent-blue/50 bg-accent-blue/[0.06]"
                      style={position(range)}
                    >
                      <button
                        type="button"
                        aria-label={bookLabel(range)}
                        title={bookLabel(range)}
                        onClick={() => void book(range.first)}
                        className="absolute top-1 left-1 flex h-6 max-w-[calc(100%-0.5rem)] items-center gap-0.5 rounded-full border border-accent-blue/70 bg-[#0c0c0e] pr-2 pl-1.5 text-[11px] font-medium whitespace-nowrap text-[#a9bfff] hover:bg-accent-blue/20 hover:text-white"
                      >
                        <Plus aria-hidden className="size-3 shrink-0" />
                        Book {clock(range.from)}
                      </button>
                    </div>
                  ))}
                {run?.events
                  .filter((listed) => listed.at.day === column)
                  .map((listed) => (
                    <EventBlock
                      key={listed.key}
                      listed={listed}
                      active={listed.key === current?.key}
                      onSelect={() => pick(listed.key)}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>

        <Inspector listed={current} ref={inspector} />
      </div>

      <div className="flex min-h-11 items-center justify-between gap-x-4 border-t border-line px-4 py-1.5 font-mono text-[11px] text-neutral-500">
        <span aria-live="polite">{message}</span>
        <button
          type="button"
          onClick={reset}
          className="h-11 min-w-11 shrink-0 px-1 hover:text-white"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/** One day's events and free ranges, in time order. */
function agenda(run: Run | undefined, day: number): (Listed | Free)[] {
  if (!run) return [];
  const start = (item: Listed | Free) => ('event' in item ? item.at.from : item.from);
  return [
    ...run.events.filter((listed) => listed.at.day === day),
    ...(run.free ?? []).filter((range) => range.day === day),
  ].sort((a, b) => start(a) - start(b));
}

const position = ({ from, to }: Placed) => ({
  top: hours((from - OPEN * 60) / 60),
  height: hours((to - from) / 60),
});

function EventBlock({
  listed: { event, source, at: block },
  active,
  onSelect,
}: {
  listed: Listed;
  active: boolean;
  onSelect: () => void;
}) {
  const minutes = block.to - block.from;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="absolute inset-x-1 overflow-hidden rounded-md border-l-2 px-1.5 text-left leading-tight text-white outline-offset-1 aria-pressed:outline aria-pressed:outline-1 aria-pressed:outline-white"
      style={{
        ...position(block),
        minHeight: 22,
        borderColor: source.color,
        background: `color-mix(in srgb, ${source.color} 22%, #0c0c0e)`,
      }}
    >
      <span className={`block truncate text-xs font-medium ${minutes < 30 ? 'leading-5' : 'pt-1'}`}>
        {event.title}
      </span>
      {minutes >= 45 && (
        <span className="block truncate text-[11px] text-neutral-300">
          {clock(block.from)} – {clock(block.to)}
        </span>
      )}
    </button>
  );
}

// The fields worth showing, in the order CalendarEvent lists them.
const FIELDS = ['id', 'kind', 'seriesId', 'title', 'start', 'end', 'status', 'showAs'] as const;

function Inspector({ listed, ref }: { listed?: Listed; ref: Ref<HTMLDivElement> }) {
  if (!listed) {
    return (
      <div
        ref={ref}
        className="flex items-center justify-center border-line p-6 text-sm text-neutral-500 max-lg:border-t lg:border-l"
      >
        Pick an event to see what calsdk returns.
      </div>
    );
  }
  const { event, source, at: block } = listed;
  return (
    <div ref={ref} className="min-w-0 scroll-mt-20 border-line max-lg:border-t lg:border-l">
      <div className="p-4">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="size-2 rounded-full" style={{ background: source.color }} />
          {source.name}
        </div>
        <p className="mt-2 text-lg font-semibold tracking-[-0.02em] text-white">{event.title}</p>
        <p className="mt-0.5 text-sm text-neutral-400">
          {DAY_NAMES[block.day]}, Nov {DAY_DATES[block.day]} · {clock(block.from)} –{' '}
          {clock(block.to)}
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
          {source.short} calls it
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-neutral-200">
            {source.field}
          </code>
          → you get
          <code className="rounded bg-accent-blue/15 px-1.5 py-0.5 font-mono text-white">
            title
          </code>
        </p>
      </div>
      {/* Wraps rather than scrolls: the values are for reading. */}
      <pre className="border-t border-line px-4 py-3 font-mono text-[11px] leading-[1.7] break-all whitespace-pre-wrap text-neutral-300">
        <span className="text-neutral-500">{'// CalendarEvent'}</span>
        {'\n{\n'}
        {FIELDS.map((field) => {
          const value = event[field];
          if (value === undefined) return null;
          return (
            <span key={field}>
              {'  '}
              <span className="text-[#79c0ff]">{field}</span>: <Value value={value} />
              {',\n'}
            </span>
          );
        })}
        {'}'}
      </pre>
    </div>
  );
}

function Value({ value }: { value: unknown }) {
  if (typeof value === 'string') return <span className="text-[#a5d6ff]">'{value}'</span>;
  if (value && typeof value === 'object') {
    return (
      <>
        {'{\n'}
        {Object.entries(value).map(([key, item]) => (
          <span key={key}>
            {'    '}
            <span className="text-[#79c0ff]">{key}</span>: <Value value={item} />
            {',\n'}
          </span>
        ))}
        {'  }'}
      </>
    );
  }
  return <span className="text-[#ffa657]">{String(value)}</span>;
}
