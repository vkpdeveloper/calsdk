import type {
  AttendeeV1,
  ConferenceV1,
  EventKindV1,
  EventPatchV1,
  EventTimeV1,
  EventV1,
  WarningV1,
} from '@calsdk/provider';
import { fromGraphRecurrence, toGraphRecurrence } from './convert-recurrence';
import { fromGraphZone, graphTimeToInstant, instantToEventTime, toGraphTime } from './graph-time';
import type { GraphEvent, GraphRecurrence, GraphTime } from './microsoft-api';
import type { MicrosoftEventMetadata } from './microsoft-options';

const KINDS: Record<NonNullable<GraphEvent['type']>, EventKindV1> = {
  singleInstance: 'single',
  seriesMaster: 'series',
  occurrence: 'occurrence',
  exception: 'exception',
};

const RESPONSES: Record<string, AttendeeV1['responseStatus']> = {
  accepted: 'accepted',
  organizer: 'accepted',
  declined: 'declined',
  tentativelyAccepted: 'tentative',
};

/** The IANA zone an event was scheduled in. */
export function eventZone(raw: GraphEvent): string {
  return fromGraphZone(raw.originalStartTimeZone) ?? 'UTC';
}

/** The start and end of an event, in the zones it was scheduled in. */
export function eventTimes(raw: GraphEvent): { start: EventTimeV1; end: EventTimeV1 } {
  const allDay = raw.isAllDay === true;
  const zone = eventZone(raw);
  return {
    start: instantToEventTime(graphTimeToInstant(raw.start), zone, allDay),
    end: instantToEventTime(
      graphTimeToInstant(raw.end),
      fromGraphZone(raw.originalEndTimeZone) ?? zone,
      allDay,
    ),
  };
}

export function fromGraphEvent(raw: GraphEvent, { calendarId }: { calendarId: string }): EventV1 {
  const { start, end } = eventTimes(raw);
  const kind = KINDS[raw.type ?? 'singleInstance'];
  const isInstance = kind === 'occurrence' || kind === 'exception';
  const metadata: MicrosoftEventMetadata = {
    showAs: raw.showAs,
    importance: raw.importance,
    categories: raw.categories,
    iCalUId: raw.iCalUId ?? undefined,
  };

  return {
    id: raw.id,
    calendarId,
    kind,
    ...(isInstance && {
      seriesId: raw.seriesMasterId ?? undefined,
      originalStart: raw.originalStart
        ? instantToEventTime(Date.parse(raw.originalStart), eventZone(raw), raw.isAllDay === true)
        : start,
    }),
    title: raw.subject || undefined,
    // Requests ask for text bodies.
    description: raw.body?.content || undefined,
    location: raw.location?.displayName || undefined,
    start,
    end,
    recurrence:
      kind === 'series' && raw.recurrence ? fromGraphRecurrence(raw.recurrence, start) : undefined,
    status: raw.isCancelled ? 'cancelled' : 'confirmed',
    showAs: raw.showAs === 'free' ? 'free' : 'busy',
    visibility: raw.sensitivity === undefined ? undefined : fromSensitivity(raw.sensitivity),
    organizer: raw.organizer?.emailAddress?.address
      ? {
          email: raw.organizer.emailAddress.address,
          name: raw.organizer.emailAddress.name,
          self: raw.isOrganizer,
        }
      : undefined,
    attendees: raw.attendees?.flatMap((attendee): AttendeeV1[] => {
      const email = attendee.emailAddress?.address;
      if (!email) return [];
      const response = attendee.status?.response ?? '';
      return [
        {
          email,
          name: attendee.emailAddress?.name,
          responseStatus: RESPONSES[response] ?? 'needsAction',
          optional: attendee.type === 'optional',
          organizer: response === 'organizer' || undefined,
        },
      ];
    }),
    conference: fromGraphConference(raw),
    reminders:
      raw.isReminderOn === undefined
        ? undefined
        : {
            useDefault: false,
            overrides: raw.isReminderOn
              ? [{ method: 'popup', minutesBefore: raw.reminderMinutesBeforeStart ?? 15 }]
              : [],
          },
    htmlLink: raw.webLink ?? undefined,
    etag: raw['@odata.etag'],
    createdAt: raw.createdDateTime,
    updatedAt: raw.lastModifiedDateTime,
    providerMetadata: { microsoft: metadata },
  };
}

function fromSensitivity(sensitivity: string): EventV1['visibility'] {
  return sensitivity === 'normal' ? 'default' : 'private';
}

function fromGraphConference(raw: GraphEvent): ConferenceV1 | undefined {
  const joinUrl = raw.onlineMeeting?.joinUrl;
  if (!joinUrl) return undefined;
  let host = '';
  try {
    host = new URL(joinUrl).hostname;
  } catch {
    // Not a URL: the provider stays 'other'.
  }
  const provider =
    raw.onlineMeetingProvider === 'teamsForBusiness' ||
    /(^|\.)teams\.(microsoft|live)\.com$/.test(host)
      ? 'teams'
      : host === 'zoom.us' || host.endsWith('.zoom.us')
        ? 'zoom'
        : 'other';
  return { provider, joinUrl };
}

/** Request body for creating or patching an Outlook event. */
export type GraphEventWrite = {
  subject?: string;
  body?: { contentType: 'text'; content: string };
  location?: { displayName: string };
  start?: GraphTime;
  end?: GraphTime;
  isAllDay?: boolean;
  recurrence?: GraphRecurrence | null;
  showAs?: string;
  sensitivity?: 'normal' | 'private';
  attendees?: { emailAddress: { address: string; name?: string }; type: 'required' | 'optional' }[];
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: 'teamsForBusiness';
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
};

/**
 * Converts a patch (or a full event input) to a Graph request body. Outlook has no
 * "cleared" state for text fields, so `null` writes an empty value.
 *
 * `seriesStart` is where the series starts, needed to write `recurrence`.
 */
export function toGraphWrite(
  patch: EventPatchV1,
  { seriesStart, warnings }: { seriesStart: EventTimeV1 | undefined; warnings: WarningV1[] },
): GraphEventWrite {
  const body: GraphEventWrite = {};
  if (patch.title !== undefined) body.subject = patch.title ?? '';
  if (patch.description !== undefined) {
    body.body = { contentType: 'text', content: patch.description ?? '' };
  }
  if (patch.location !== undefined) body.location = { displayName: patch.location ?? '' };
  if (patch.start !== undefined) {
    body.start = toGraphTime(patch.start);
    body.isAllDay = patch.start.date !== undefined;
  }
  if (patch.end !== undefined) body.end = toGraphTime(patch.end);
  if (patch.recurrence === null) {
    body.recurrence = null;
  } else if (patch.recurrence !== undefined) {
    // Callers pass the start whenever recurrence is set.
    if (seriesStart) body.recurrence = toGraphRecurrence(patch.recurrence, seriesStart);
  }
  if (patch.showAs !== undefined) body.showAs = patch.showAs ?? 'busy';
  if (patch.visibility !== undefined) {
    body.sensitivity = patch.visibility === 'private' ? 'private' : 'normal';
    if (patch.visibility === 'public') {
      warnings.push({
        type: 'compatibility',
        feature: 'visibility',
        details: 'Outlook has no public visibility. The event was saved with normal visibility.',
      });
    }
  }
  if (patch.attendees !== undefined) {
    body.attendees = (patch.attendees ?? []).map(({ email, name, optional }) => ({
      emailAddress: { address: email, name },
      type: optional ? 'optional' : 'required',
    }));
  }
  if (patch.createConference === true) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = 'teamsForBusiness';
  } else if (patch.createConference === false) {
    body.isOnlineMeeting = false;
  }
  if (patch.reminders !== undefined) writeReminders(body, patch.reminders, warnings);
  if (patch.color !== undefined && patch.color !== null) {
    warnings.push({
      type: 'unsupported',
      feature: 'color',
      details:
        'Outlook events have no color of their own. Use providerOptions.microsoft.categories instead.',
    });
  }
  return body;
}

function writeReminders(
  body: GraphEventWrite,
  reminders: EventPatchV1['reminders'],
  warnings: WarningV1[],
) {
  if (!reminders || reminders.useDefault) {
    warnings.push({
      type: 'unsupported',
      feature: 'reminders',
      details: 'Outlook has no per-event default reminder. The reminder was left unchanged.',
    });
    return;
  }
  const overrides = reminders.overrides ?? [];
  const popups = overrides.filter((reminder) => reminder.method === 'popup');
  const [first] = popups;
  body.isReminderOn = first !== undefined;
  if (first) body.reminderMinutesBeforeStart = Math.max(...popups.map((r) => r.minutesBefore));
  if (popups.length !== overrides.length || popups.length > 1) {
    warnings.push({
      type: 'unsupported',
      feature: 'reminders',
      details:
        'Outlook supports one popup reminder per event. Only the earliest popup reminder was kept.',
    });
  }
}
