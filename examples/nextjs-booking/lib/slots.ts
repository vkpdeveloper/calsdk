import 'server-only';
import { findFreeTime } from '@cal-sdk/core';
import { calendar } from './calendar';
import { booking } from './config';

const MINUTE_MS = 60_000;

/** Free start times from an hour from now until `daysAhead` days out. */
export async function openSlots(from = new Date(Date.now() + 60 * MINUTE_MS)) {
  const { slots } = await findFreeTime({
    calendars: [{ calendar }],
    timeMin: from,
    timeMax: new Date(from.getTime() + booking.daysAhead * 86_400_000),
    duration: booking.duration,
    workingHours: booking.workingHours,
    slotInterval: booking.duration,
  });
  return slots.map((slot) => slot.start);
}

/** Whether the meeting starting at `start` still fits, checked against the live calendar. */
export async function isStillFree(start: Date) {
  const end = new Date(start.getTime() + booking.duration * MINUTE_MS);
  const { slots } = await findFreeTime({
    calendars: [{ calendar }],
    timeMin: start,
    timeMax: end,
    duration: booking.duration,
    workingHours: booking.workingHours,
  });
  return slots.some((slot) => new Date(slot.start).getTime() === start.getTime());
}
