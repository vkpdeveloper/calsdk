import 'server-only';
import type { CalendarProvider } from '@cal-sdk/core';
import { google } from '@cal-sdk/google';
import { mockCalendar } from '@cal-sdk/mock';
import { booking } from './config';

/** Whether bookings go to a real Google Calendar. Without credentials the page runs on a demo calendar. */
export const isDemo = !(
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_REFRESH_TOKEN
);

export const calendar: CalendarProvider = isDemo
  ? demoCalendar()
  : google({ accessToken: googleAccessToken });

let cached: { token: string; expiresAt: number } | undefined;

/** Trades the owner's refresh token for an access token, reused until shortly before it expires. */
async function googleAccessToken() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN ?? '',
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed (HTTP ${response.status})`);
  const { access_token, expires_in } = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cached = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

/** A calendar with a few meetings over the next weekdays, so the page has something to work around. */
function demoCalendar() {
  // The next weekdays after today, as YYYY-MM-DD.
  const weekdays: string[] = [];
  for (let offset = 1; weekdays.length < 3; offset++) {
    const date = new Date(Date.now() + offset * 86_400_000);
    if (date.getUTCDay() % 6 !== 0) weekdays.push(date.toISOString().slice(0, 10));
  }
  // UTC times, so the demo doesn't depend on the server's time zone.
  const at = (weekday: number, time: string) => ({
    dateTime: `${weekdays[weekday - 1]}T${time}:00Z`,
    timeZone: 'UTC',
  });

  return mockCalendar({
    calendars: [{ id: 'primary', name: 'Demo', timeZone: booking.timeZone }],
    events: [
      {
        title: 'Standup',
        start: at(1, '09:30'),
        end: at(1, '10:00'),
        recurrence: ['RRULE:FREQ=DAILY;COUNT=14'],
      },
      { title: 'Design review', start: at(1, '13:00'), end: at(1, '15:00') },
      { title: 'Lunch', start: at(2, '12:00'), end: at(2, '13:30') },
      { title: 'Customer call', start: at(3, '10:00'), end: at(3, '12:00') },
    ],
  });
}
