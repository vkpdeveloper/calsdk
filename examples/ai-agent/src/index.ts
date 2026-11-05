import { anthropic } from '@ai-sdk/anthropic';
import { type CalendarProvider, createEvent, findFreeTime, listEvents } from '@cal-sdk/core';
import { google } from '@cal-sdk/google';
import { mockCalendar } from '@cal-sdk/mock';
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';

const localTime = z
  .string()
  .describe('Local date-time without an offset, e.g. 2026-11-09T14:00:00');
const instant = z
  .string()
  .describe('ISO 8601 date-time with an offset, e.g. 2026-11-09T14:00:00+01:00');

/**
 * Calendar tools for one user. Build them per request with that user's provider, so an
 * agent only ever sees the calendar of the person it's talking to.
 */
function calendarTools(calendar: CalendarProvider, timeZone: string) {
  return {
    listEvents: tool({
      description:
        'List events between two times, recurring events expanded. If nextPageToken is returned, call again with it as pageToken for the rest.',
      inputSchema: z.object({ from: instant, to: instant, pageToken: z.string().optional() }),
      execute: async ({ from, to, pageToken }) => {
        const { events, nextPageToken } = await listEvents({
          calendar,
          timeMin: from,
          timeMax: to,
          pageToken,
        });
        return {
          events: events.map(({ id, title, start, end }) => ({ id, title, start, end })),
          nextPageToken,
        };
      },
    }),

    findFreeTime: tool({
      description: 'Find free slots of a given length during working hours (09:00 to 18:00).',
      inputSchema: z.object({
        from: instant,
        to: instant,
        minutes: z.number().int().positive(),
      }),
      execute: async ({ from, to, minutes }) => {
        const { slots } = await findFreeTime({
          calendars: [{ calendar }],
          timeMin: from,
          timeMax: to,
          duration: minutes,
          workingHours: { start: '09:00', end: '18:00', timeZone },
          slotInterval: 30,
        });
        return slots.slice(0, 10);
      },
    }),

    createEvent: tool({
      description: 'Book an event and invite attendees.',
      inputSchema: z.object({
        title: z.string(),
        start: localTime,
        end: localTime,
        attendees: z.array(z.string().describe('Email address')).optional(),
      }),
      execute: async ({ title, start, end, attendees }) => {
        const { event } = await createEvent({
          calendar,
          event: {
            title,
            start: { dateTime: start, timeZone },
            end: { dateTime: end, timeZone },
            attendees: attendees?.map((email) => ({ email })),
          },
          sendUpdates: 'all',
        });
        return { id: event.id, title: event.title, start: event.start, link: event.htmlLink };
      },
    }),
  };
}

const timeZone = 'Europe/Berlin';
// Tomorrow in Berlin, not in UTC: just after midnight there, UTC is still on the day before.
const berlinToday = new Date().toLocaleDateString('en-CA', { timeZone }); // YYYY-MM-DD
const nextDay = new Date(`${berlinToday}T00:00:00Z`);
nextDay.setUTCDate(nextDay.getUTCDate() + 1);
const tomorrow = nextDay.toISOString().slice(0, 10);

// A real calendar when a token is set, otherwise an in-memory one with a busy tomorrow.
const calendar = process.env.GOOGLE_ACCESS_TOKEN
  ? google({ accessToken: process.env.GOOGLE_ACCESS_TOKEN })
  : mockCalendar({
      events: [
        {
          title: 'Design review',
          start: { dateTime: `${tomorrow}T13:00:00`, timeZone },
          end: { dateTime: `${tomorrow}T15:00:00`, timeZone },
        },
        {
          title: 'Customer call',
          start: { dateTime: `${tomorrow}T15:30:00`, timeZone },
          end: { dateTime: `${tomorrow}T16:30:00`, timeZone },
        },
      ],
    });

const { text, steps } = await generateText({
  model: anthropic('claude-sonnet-5-5'),
  tools: calendarTools(calendar, timeZone),
  stopWhen: isStepCount(6),
  instructions: `You manage the user's calendar. Today is ${new Date().toLocaleDateString('en-US', { timeZone, dateStyle: 'full' })}. All times are in ${timeZone}.`,
  prompt:
    process.argv[2] ??
    'Find an hour tomorrow afternoon for a planning session with ana@example.com and book it.',
});

for (const step of steps)
  for (const call of step.toolCalls) console.log(`> ${call.toolName}`, JSON.stringify(call.input));
console.log(`\n${text}`);
