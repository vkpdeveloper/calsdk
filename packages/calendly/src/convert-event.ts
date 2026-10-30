import type { AttendeeV1, ConferenceV1, EventTimeV1, EventV1 } from '@calsdk/provider';
import { formatZonedDateTime } from '@calsdk/provider-utils';
import type { Invitee, ScheduledEvent } from './calendly-api';
import type { CalendlyEventMetadata } from './calendly-options';

/** The uuid that ends a Calendly URI, such as a scheduled event's: its event id. */
export function uuidOf(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

const CONFERENCES = new Map<string, ConferenceV1['provider']>([
  ['zoom', 'zoom'],
  ['zoom_conference', 'zoom'],
  ['google_conference', 'google-meet'],
  ['microsoft_teams_conference', 'teams'],
]);

/**
 * A scheduled event as an event in `timeZone`. `invitees` are only read for single events:
 * listing them takes a request per event. Without them, `attendees` is left out rather
 * than listing only the hosts.
 */
export function fromScheduledEvent(
  event: ScheduledEvent,
  { timeZone, invitees }: { timeZone: string; invitees?: Invitee[] },
): EventV1 {
  const time = (instant: string): EventTimeV1 => ({
    dateTime: formatZonedDateTime(Date.parse(instant), timeZone),
    timeZone,
  });
  const hosts = (event.event_memberships ?? []).flatMap((member) =>
    member.user_email ? [{ email: member.user_email, name: member.user_name ?? undefined }] : [],
  );
  const joinUrl = event.location?.join_url;
  const metadata: CalendlyEventMetadata = {
    uri: event.uri,
    eventType: event.event_type ?? undefined,
  };

  return {
    id: uuidOf(event.uri),
    calendarId: 'primary',
    kind: 'single',
    title: event.name || undefined,
    location: event.location?.location || undefined,
    start: time(event.start_time),
    end: time(event.end_time),
    status: 'confirmed',
    showAs: 'busy',
    organizer: hosts[0],
    attendees: invitees && [
      ...hosts.map((host) => ({ ...host, responseStatus: 'accepted' as const, organizer: true })),
      ...invitees
        .filter((invitee) => invitee.status === 'active')
        .map(
          (invitee): AttendeeV1 => ({
            email: invitee.email,
            name: invitee.name || undefined,
            // Invitees book the time themselves.
            responseStatus: 'accepted',
          }),
        ),
      ...(event.event_guests ?? []).map(
        (guest): AttendeeV1 => ({ email: guest.email, responseStatus: 'needsAction' }),
      ),
    ],
    conference: joinUrl?.startsWith('https://')
      ? { provider: CONFERENCES.get(event.location?.type ?? '') ?? 'other', joinUrl }
      : undefined,
    createdAt: event.created_at ?? undefined,
    updatedAt: event.updated_at ?? undefined,
    providerMetadata: { calendly: metadata },
  };
}
