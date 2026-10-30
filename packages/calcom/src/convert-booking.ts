import type { EventTimeV1, EventV1 } from '@calsdk/provider';
import { formatZonedDateTime, isValidTimeZone } from '@calsdk/provider-utils';
import type { Booking } from './calcom-api';
import type { CalcomEventMetadata } from './calcom-options';

/** Cancelled and rejected bookings are gone: calsdk reports them as deleted. */
export function isActive(booking: Booking): boolean {
  return booking.status !== 'cancelled' && booking.status !== 'rejected';
}

/**
 * The zone a booking was made in. Cal.com stores times in UTC with the attendee's zone,
 * which is the zone calsdk books with.
 */
export function bookingZone(booking: Booking): string {
  for (const person of [...(booking.attendees ?? []), ...(booking.hosts ?? [])]) {
    if (person.timeZone && isValidTimeZone(person.timeZone)) return person.timeZone;
  }
  return 'UTC';
}

export function fromBooking(booking: Booking, { calendarId }: { calendarId: string }): EventV1 {
  const zone = bookingZone(booking);
  const time = (instant: string): EventTimeV1 => ({
    dateTime: formatZonedDateTime(Date.parse(instant), zone),
    timeZone: zone,
  });
  const host = booking.hosts?.find((person) => person.email);
  const metadata: CalcomEventMetadata = {
    bookingId: booking.id,
    eventTypeId: booking.eventTypeId ?? undefined,
    status: booking.status,
    rescheduledFromUid: booking.rescheduledFromUid ?? undefined,
    metadata:
      booking.metadata && Object.keys(booking.metadata).length > 0 ? booking.metadata : undefined,
  };

  return {
    id: booking.uid,
    calendarId,
    kind: 'single',
    title: booking.title || undefined,
    description: booking.description || undefined,
    // Cal Video bookings repeat the meeting link as their location.
    location:
      booking.location && booking.location !== booking.meetingUrl ? booking.location : undefined,
    start: time(booking.start),
    end: time(booking.end),
    status: booking.status === 'accepted' ? 'confirmed' : 'tentative',
    showAs: 'busy',
    organizer: host?.email ? { email: host.email, name: host.name ?? undefined } : undefined,
    attendees: [
      ...(host?.email
        ? [
            {
              email: host.email,
              name: host.name ?? undefined,
              responseStatus: 'accepted' as const,
              organizer: true,
            },
          ]
        : []),
      ...(booking.attendees ?? []).flatMap((person) =>
        person.email
          ? [
              {
                email: person.email,
                name: person.name ?? undefined,
                // Attendees book the time themselves.
                responseStatus: 'accepted' as const,
              },
            ]
          : [],
      ),
    ],
    conference: booking.meetingUrl?.startsWith('https://')
      ? { provider: 'other', joinUrl: booking.meetingUrl }
      : undefined,
    createdAt: booking.createdAt ?? undefined,
    updatedAt: booking.updatedAt ?? undefined,
    providerMetadata: { calcom: metadata },
  };
}
