'use client';

import { mockCalendar } from '@calsdk/mock';
import { createEvent, type FreeSlot, findFreeTime, listEvents } from 'calsdk';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

// A fixed week in January, so New York stays on one offset and the demo is the same for
// every visitor. Only weekday names are shown.
const ZONE = 'America/New_York';
const OFFSET = '-05:00';
const DAYS = ['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const OPEN = 9;
const CLOSE = 18;
// Hour rows are sized by the --hour CSS variable, taller on wide screens so the grid ends
// level with the controls beside it.
const hours = (n: number) => `calc(var(--hour) * ${n})`;
const HOURS = Array.from({ length: CLOSE - OPEN }, (_, i) => OPEN + i);

type Seed = [day: number, start: string, end: string, title: string];

const YOU: Seed[] = [
  [0, '10:00', '11:30', 'Design review'],
  [0, '14:00', '15:00', '1:1'],
  [1, '13:00', '15:30', 'Planning'],
  [2, '11:00', '12:00', 'Customer call'],
  [2, '15:00', '17:00', 'Focus time'],
  [3, '10:00', '12:30', 'Workshop'],
  [3, '16:00', '17:00', 'Interview'],
  [4, '13:00', '14:00', 'Lunch and learn'],
];

const SAM: Seed[] = [
  [0, '09:00', '10:00', 'Gym'],
  [0, '12:00', '14:00', 'Offsite lunch'],
  [1, '09:00', '11:30', 'Sprint review'],
  [1, '16:00', '18:00', 'Dentist'],
  [2, '09:00', '11:00', 'Hiring sync'],
  [2, '13:00', '15:00', 'Roadmap'],
  [3, '13:00', '16:00', 'Training'],
  [4, '09:00', '12:00', 'Out'],
  [4, '15:00', '18:00', 'Travel'],
];

const at = (day: number, time: string) => ({
  dateTime: `${DAYS[day]}T${time}:00${OFFSET}`,
  timeZone: ZONE,
});

function createCalendars() {
  const toEvent = ([day, start, end, title]: Seed) => ({
    title,
    start: at(day, start),
    end: at(day, end),
  });
  return {
    you: mockCalendar({
      events: [
        ...YOU.map(toEvent),
        {
          title: 'Standup',
          ...{ start: at(0, '09:30'), end: at(0, '09:45') },
          recurrence: ['RRULE:FREQ=DAILY;COUNT=5'],
        },
      ],
    }),
    sam: mockCalendar({ events: SAM.map(toEvent) }),
  };
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

type Block = { day: number; from: number; to: number; title: string };

function toBlock(start: string, end: string, title = ''): Block {
  const a = place(start);
  return { day: a.day, from: a.minutes, to: place(end).minutes, title };
}

/** Joins overlapping slots of a day into the ranges a meeting can start and end in. */
function freeRanges(slots: FreeSlot[]): Block[] {
  const ranges: Block[] = [];
  for (const slot of slots) {
    const block = toBlock(slot.start, slot.end);
    const last = ranges.at(-1);
    if (last && last.day === block.day && block.from <= last.to) last.to = block.to;
    else ranges.push(block);
  }
  return ranges;
}

type State = { you: Block[]; sam: Block[]; slots: FreeSlot[]; ms: number };

/** `lengths` are the meeting lengths to offer, in minutes, each with its highlighted code. */
export function FreeTimeDemo({ lengths }: { lengths: { minutes: number; code: ReactNode }[] }) {
  const [calendars, setCalendars] = useState(createCalendars);
  const [duration, setDuration] = useState(lengths[1]?.minutes ?? 60);
  const [state, setState] = useState<State>();
  const [booked, setBooked] = useState<string>();

  const run = useCallback(async () => {
    const range = {
      timeMin: `${DAYS[0]}T00:00:00${OFFSET}`,
      timeMax: `2027-01-16T00:00:00${OFFSET}`,
    };
    const read = async (calendar: typeof calendars.you) => {
      const { events } = await listEvents({ calendar, ...range });
      return events.flatMap((event) =>
        event.start.dateTime && event.end.dateTime
          ? [toBlock(event.start.dateTime, event.end.dateTime, event.title)]
          : [],
      );
    };
    const started = performance.now();
    const { slots } = await findFreeTime({
      calendars: [{ calendar: calendars.you }, { calendar: calendars.sam }],
      ...range,
      duration,
      slotInterval: 30,
      workingHours: { start: '09:00', end: '18:00', timeZone: ZONE },
    });
    const ms = performance.now() - started;
    setState({ you: await read(calendars.you), sam: await read(calendars.sam), slots, ms });
  }, [calendars, duration]);

  useEffect(() => {
    // The mock provider notes that it computes free/busy from events. That is expected here.
    globalThis.CALSDK_WARNINGS = 'silent';
    void run();
  }, [run]);

  async function book(slot: FreeSlot) {
    for (const calendar of [calendars.you, calendars.sam]) {
      await createEvent({
        calendar,
        event: {
          title: 'New meeting',
          start: { dateTime: slot.start, timeZone: ZONE },
          end: { dateTime: slot.end, timeZone: ZONE },
        },
      });
    }
    const { day, minutes } = place(slot.start);
    setBooked(`${DAY_NAMES[day]} ${clock(minutes)}`);
    await run();
  }

  function reset() {
    setCalendars(createCalendars());
    setBooked(undefined);
  }

  // The first slot of each free range, so the choices are spread over the week.
  const earliest = state?.slots.filter((slot, i, all) => {
    const previous = all[i - 1];
    return (
      !previous || previous.end < slot.start || place(previous.start).day !== place(slot.start).day
    );
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0 self-start overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-3 text-xs text-neutral-400">
          <Legend className="bg-neutral-600">Your calendar</Legend>
          <Legend className="border border-dashed border-neutral-400">Sam's calendar</Legend>
          <Legend className="bg-accent-blue/40 border border-accent-blue">Free for both</Legend>
          <span className="ml-auto">New York time</span>
        </div>
        {/* Phones scroll the week sideways at a width where event names still fit. */}
        <div className="x-scroll overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-[2.75rem_repeat(5,1fr)] px-2 pb-4 [--hour:44px] sm:px-4 lg:[--hour:60px]">
            <div className="sticky left-0 z-10 bg-panel" />
            {DAY_NAMES.map((name) => (
              <div key={name} className="py-2 text-center text-xs font-medium text-neutral-400">
                {name}
              </div>
            ))}
            {/* Sticky, so the hours stay in view while a phone scrolls the week. */}
            <div className="sticky left-0 z-10 bg-panel" style={{ height: hours(CLOSE - OPEN) }}>
              {[...HOURS, CLOSE].map((hour) => (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-neutral-400"
                  style={{ top: hours(hour - OPEN) }}
                >
                  {clock(hour * 60)}
                </span>
              ))}
            </div>
            {DAYS.map((date, day) => (
              <div
                key={date}
                className="relative border-l border-line"
                style={{ height: hours(CLOSE - OPEN) }}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-[#1c1c20]"
                    style={{ top: hours(hour - OPEN) }}
                  />
                ))}
                {state &&
                  freeRanges(state.slots)
                    .filter((range) => range.day === day)
                    .map((range) => (
                      <Placed
                        key={`free-${range.from}`}
                        block={range}
                        className="inset-x-0.5 rounded-md border border-accent-blue/70 bg-accent-blue/15"
                      />
                    ))}
                {state?.you
                  .filter((block) => block.day === day)
                  .map((block) => (
                    <Placed
                      key={`you-${block.from}-${block.title}`}
                      block={block}
                      className="left-1 right-1/2 mr-0.5 rounded bg-neutral-600 text-neutral-100"
                    />
                  ))}
                {state?.sam
                  .filter((block) => block.day === day)
                  .map((block) => (
                    <Placed
                      key={`sam-${block.from}-${block.title}`}
                      block={block}
                      className="left-1/2 right-1 ml-0.5 rounded border border-dashed border-neutral-400 bg-fd-background text-neutral-300"
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <p className="mb-2 text-sm text-neutral-400">Meeting length</p>
          <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
            {lengths.map(({ minutes: value }) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === duration}
                onClick={() => setDuration(value)}
                className="h-11 flex-1 rounded-md text-sm sm:h-9 text-neutral-400 hover:text-white aria-pressed:bg-neutral-800 aria-pressed:text-white"
              >
                {value} min
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm text-neutral-400">Book a slot on both calendars</p>
          <div className="flex flex-wrap gap-2">
            {earliest?.slice(0, 6).map((slot) => {
              const { day, minutes } = place(slot.start);
              return (
                <button
                  key={slot.start}
                  type="button"
                  onClick={() => void book(slot)}
                  className="h-11 rounded-md border border-line px-3 font-mono text-xs sm:h-9 text-neutral-200 hover:border-accent-blue hover:text-white"
                >
                  {DAY_NAMES[day]} {clock(minutes)}
                </button>
              );
            })}
            {state && state.slots.length === 0 && (
              <p className="text-sm text-neutral-400">No time left this week.</p>
            )}
          </div>
        </div>
        <div className="code overflow-hidden rounded-xl border border-line bg-panel">
          {lengths.find((length) => length.minutes === duration)?.code}
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-neutral-400">
          <span aria-live="polite">
            {booked ? `Booked ${booked}. ` : ''}
            {state ? `Ran in your browser in ${state.ms.toFixed(1)} ms.` : ''}
          </span>
          <button
            type="button"
            onClick={reset}
            className="h-11 shrink-0 rounded-md px-3 text-neutral-400 sm:h-8 sm:px-2 hover:text-white"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function Legend({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`size-3 rounded-sm ${className}`} />
      {children}
    </span>
  );
}

function Placed({ block, className }: { block: Block; className: string }) {
  const minutes = block.to - block.from;
  return (
    <div
      className={`absolute overflow-hidden px-1.5 py-1 text-[10px] leading-tight sm:text-[11px] ${className}`}
      style={{ top: hours((block.from - OPEN * 60) / 60), height: hours(minutes / 60) }}
    >
      {minutes >= 36 && block.title && <span className="block">{block.title}</span>}
    </div>
  );
}
