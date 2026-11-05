'use server';

import { createEvent } from '@cal-sdk/core';
import { revalidatePath } from 'next/cache';
import { calendar, isDemo } from '@/lib/calendar';
import { booking } from '@/lib/config';
import { isStillFree } from '@/lib/slots';

export type BookingState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'booked'; start: string; email: string };

export async function book(_previous: BookingState, form: FormData): Promise<BookingState> {
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const start = new Date(String(form.get('start') ?? ''));

  if (!name || !/^[^\s@]+@[^\s@]+$/.test(email) || Number.isNaN(start.getTime())) {
    return { status: 'error', message: 'Add your name and a valid email.' };
  }
  // The page may be minutes old: check the live calendar before writing.
  if (!(await isStillFree(start))) {
    return { status: 'error', message: 'That time was just taken. Pick another one.' };
  }

  const end = new Date(start.getTime() + booking.duration * 60_000);
  await createEvent({
    calendar,
    event: {
      title: `${booking.title}: ${name}`,
      start: { dateTime: start.toISOString(), timeZone: booking.timeZone },
      end: { dateTime: end.toISOString(), timeZone: booking.timeZone },
      attendees: [{ email, name }],
      createConference: !isDemo,
    },
    sendUpdates: 'all',
  });

  revalidatePath('/');
  return { status: 'booked', start: start.toISOString(), email };
}
