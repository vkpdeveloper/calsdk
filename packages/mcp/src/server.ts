import {
  type CalendarProvider,
  createEvent,
  deleteEvent,
  findFreeTime,
  listCalendars,
  listEvents,
  updateEvent,
} from '@cal-sdk/core';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };

const time = z.union([
  z.object({
    dateTime: z
      .string()
      .describe('ISO 8601 date-time, with or without an offset, e.g. 2026-11-03T10:00:00'),
    timeZone: z.string().describe('IANA time zone, e.g. Europe/Berlin'),
  }),
  z.object({
    date: z.string().describe('YYYY-MM-DD for all-day events. For end, the day after the last day'),
  }),
]);
const attendees = z.array(
  z.object({ email: z.string(), name: z.string().optional(), optional: z.boolean().optional() }),
);
const recurrence = z
  .array(z.string())
  .describe('RFC 5545 lines, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"]');
const showAs = z.enum(['busy', 'free']);
const visibility = z.enum(['default', 'public', 'private']);
const scope = z
  .enum(['this', 'all', 'thisAndFollowing'])
  .optional()
  .describe(
    'For an instance of a recurring event: this one (default), the series, or this and later ones',
  );
const sendUpdates = z
  .enum(['all', 'externalOnly', 'none'])
  .optional()
  .describe('Whether attendees are emailed. Provider default when omitted');
const calendarId = z
  .string()
  .optional()
  .describe('Calendar id from list_calendars. Defaults to the primary calendar');
const timeBound = (edge: string) =>
  z
    .string()
    .describe(`${edge} of the window: ISO 8601 with an offset, e.g. 2026-11-09T09:00:00+01:00`);

const DAY_MS = 86_400_000;
const MAX_FREE_TIME_DAYS = 92;

const eventInput = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: time,
  end: time,
  recurrence: recurrence.optional(),
  attendees: attendees.optional(),
  createConference: z.boolean().optional().describe('Add a Google Meet or Teams link'),
  showAs: showAs.optional(),
  visibility: visibility.optional(),
});
const eventPatch = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start: time.optional(),
  end: time.optional(),
  recurrence: recurrence.nullable().optional(),
  attendees: attendees.nullable().optional(),
  createConference: z.boolean().nullable().optional(),
  showAs: showAs.nullable().optional(),
  visibility: visibility.nullable().optional(),
});

/** A tool result carrying `value` as JSON text. */
function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Creates an MCP server exposing calendar tools over the given accounts, keyed by the
 * name the model uses to pick one. The first account is the default.
 *
 * @example
 * const server = createCalendarServer({ work: google({ accessToken }), home: icloud(...) });
 * await server.connect(new StdioServerTransport());
 */
export function createCalendarServer(accounts: Record<string, CalendarProvider>): McpServer {
  const [defaultName, ...otherNames] = Object.keys(accounts);
  if (defaultName === undefined) throw new Error('createCalendarServer needs at least one account');
  const names = [defaultName, ...otherNames] as const;

  const accountName = z
    .enum(names)
    .optional()
    .describe(`Connected account. Defaults to "${defaultName}"`);

  function calendarOf(name: string = names[0]) {
    const calendar = accounts[name];
    if (!calendar) throw new Error(`Unknown account "${name}". Connected: ${names.join(', ')}`);
    return calendar;
  }

  const server = new McpServer({
    name: 'calsdk',
    title: 'calsdk calendars',
    version: packageJson.version,
    websiteUrl: 'https://www.cal-sdk.com/docs/guides/mcp',
  });

  server.registerTool(
    'list_calendars',
    {
      title: 'List calendars',
      description: `List calendars with their ids, names, time zones and access. Connected accounts: ${names.join(', ')}.`,
      inputSchema: z.object({ account: accountName.describe('Omit to list every account') }),
      annotations: { readOnlyHint: true },
    },
    async ({ account }, ctx) => {
      const chosen = account === undefined ? names : [account];
      const result = await Promise.all(
        chosen.map(async (name) => {
          const { calendars, warnings } = await listCalendars({
            calendar: calendarOf(name),
            abortSignal: ctx.mcpReq.signal,
          });
          return { account: name, calendars, warnings };
        }),
      );
      return json(result);
    },
  );

  server.registerTool(
    'list_events',
    {
      title: 'List events',
      description:
        'List events in a time window, with recurring events expanded into their occurrences, ordered by start.',
      inputSchema: z.object({
        account: accountName,
        calendarId,
        timeMin: timeBound('Start'),
        timeMax: timeBound('End'),
        query: z.string().optional().describe('Free-text search, where the provider supports it'),
        pageToken: z.string().optional().describe('nextPageToken from a previous call'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ account, ...options }, ctx) => {
      const { events, nextPageToken, warnings } = await listEvents({
        calendar: calendarOf(account),
        ...options,
        pageSize: 100,
        abortSignal: ctx.mcpReq.signal,
      });
      return json({ events, nextPageToken, warnings });
    },
  );

  server.registerTool(
    'find_free_time',
    {
      title: 'Find free time',
      description: `Find meeting slots when every listed calendar is free, across accounts and providers, in a window of up to ${MAX_FREE_TIME_DAYS} days. Fails instead of guessing if a calendar cannot be read.`,
      inputSchema: z.object({
        // An empty list would read no calendar and call every slot free.
        calendars: z
          .array(
            z.object({
              account: z.enum(names),
              calendarIds: z.array(z.string()).min(1).optional(),
            }),
          )
          .min(1)
          .optional()
          .describe(
            'Calendars that must be free. Defaults to the primary calendar of every account',
          ),
        timeMin: timeBound('Start'),
        timeMax: timeBound('End'),
        duration: z.number().int().positive().describe('Meeting length in minutes'),
        workingHours: z
          .object({
            start: z.string().describe('HH:mm'),
            end: z.string().describe('HH:mm'),
            timeZone: z.string().describe('IANA time zone'),
            days: z
              .array(z.number().int().min(0).max(6))
              .optional()
              .describe('0 is Sunday. Defaults to Monday to Friday'),
          })
          .optional(),
        slotInterval: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Minutes between slot starts. Defaults to 15'),
        maxSlots: z.number().int().positive().optional().describe('Defaults to 20'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ calendars, maxSlots = 20, ...options }, ctx) => {
      // findFreeTime builds every slot in the window before maxSlots applies, so a long
      // window with a short interval would block the server. Unparseable bounds are left
      // to findFreeTime, which rejects them.
      const windowMs = Date.parse(options.timeMax) - Date.parse(options.timeMin);
      if (windowMs > MAX_FREE_TIME_DAYS * DAY_MS) {
        throw new Error(
          `find_free_time searches at most ${MAX_FREE_TIME_DAYS} days at a time. Split the window.`,
        );
      }
      const selected = calendars ?? names.map((account) => ({ account, calendarIds: undefined }));
      const { slots, warnings } = await findFreeTime({
        ...options,
        calendars: selected.map(({ account, calendarIds }) => ({
          calendar: calendarOf(account),
          calendarIds,
        })),
        abortSignal: ctx.mcpReq.signal,
      });
      return json({ slots: slots.slice(0, maxSlots), totalSlots: slots.length, warnings });
    },
  );

  server.registerTool(
    'create_event',
    {
      title: 'Create event',
      description:
        'Create an event, optionally recurring or with attendees, and return it as stored.',
      inputSchema: z.object({ account: accountName, calendarId, event: eventInput, sendUpdates }),
    },
    async ({ account, ...options }, ctx) => {
      const { event, warnings } = await createEvent({
        calendar: calendarOf(account),
        ...options,
        abortSignal: ctx.mcpReq.signal,
      });
      return json({ event, warnings });
    },
  );

  server.registerTool(
    'update_event',
    {
      title: 'Update event',
      description:
        'Change some fields of an event. Omitted fields stay the same and null clears a field.',
      inputSchema: z.object({
        account: accountName,
        calendarId,
        eventId: z.string(),
        patch: eventPatch,
        scope,
        sendUpdates,
      }),
      // Not idempotent: a retried createConference adds another meeting link.
    },
    async ({ account, ...options }, ctx) => {
      const { event, warnings } = await updateEvent({
        calendar: calendarOf(account),
        ...options,
        abortSignal: ctx.mcpReq.signal,
      });
      return json({ event, warnings });
    },
  );

  server.registerTool(
    'delete_event',
    {
      title: 'Delete event',
      description: 'Delete an event, one instance of a recurring event, or part of a series.',
      inputSchema: z.object({
        account: accountName,
        calendarId,
        eventId: z.string(),
        scope,
        sendUpdates,
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ account, ...options }, ctx) => {
      const { warnings } = await deleteEvent({
        calendar: calendarOf(account),
        ...options,
        abortSignal: ctx.mcpReq.signal,
      });
      return json({ deleted: true, warnings });
    },
  );

  return server;
}
