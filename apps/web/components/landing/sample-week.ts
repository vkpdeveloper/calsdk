import { type EventOf, type FreeSlot, findFreeTime, listEvents } from '@cal-sdk/core';
import { type MockCalendarProvider, mockCalendar } from '@cal-sdk/mock';
import type { ProviderLogoId } from '@/components/provider-logo';

// The landing demo's sample week. It has no 'use client', so the page can read the first
// week on the server and the demo arrives with its events in the HTML.

// A fixed week, so New York stays on one offset and every visitor sees the same calendar.
const ZONE = 'America/New_York';
const OFFSET = '-05:00';
export const DAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
const RANGE = { timeMin: `${DAYS[0]}T00:00:00${OFFSET}`, timeMax: `2026-11-14T00:00:00${OFFSET}` };

type Seed = [day: number, start: string, end: string, title: string];

// Six sample calendars. `field` is what that provider's own API calls an event's title.
export const SOURCES = [
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
    id: 'microsoft',
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
  id: ProviderLogoId;
  name: string;
  short: string;
  field: string;
  color: string;
  seeds: Seed[];
}[];

export type Source = (typeof SOURCES)[number];
export type SourceId = Source['id'];
export type Calendars = Record<SourceId, MockCalendarProvider>;

export const at = (day: number, time: string) => ({
  dateTime: `${DAYS[day]}T${time}:00${OFFSET}`,
  timeZone: ZONE,
});

export function createCalendars() {
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
  ) as Calendars;
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

export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export type Placed = { day: number; from: number; to: number };

export function span(start: string, end: string): Placed {
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

export type Listed = {
  event: EventOf<MockCalendarProvider>;
  source: Source;
  key: string;
  at: Placed;
};
export type Free = Placed & { first: FreeSlot };
export type Run = { events: Listed[]; free?: Free[]; ms: number };

/** Reads the week from the calendars that are on, with free time when `finding`. */
export async function readWeek(
  calendars: Calendars,
  shown: Source[],
  finding: boolean,
): Promise<Run> {
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
  return { events, free, ms: performance.now() - started };
}
