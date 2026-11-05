import { caldav, icloud } from '@cal-sdk/caldav';
import type { CalendarProvider } from '@cal-sdk/core';
import { google } from '@cal-sdk/google';
import { microsoft } from '@cal-sdk/microsoft';
import { mockCalendar } from '@cal-sdk/mock';
import { refreshingToken } from './refreshing-token';

type Env = Record<string, string | undefined>;

/** Help text listing the variables `accountsFromEnv` reads. */
export const envHelp = `Connect at least one calendar with environment variables:

  Google      GOOGLE_ACCESS_TOKEN, or GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
  Outlook     MICROSOFT_ACCESS_TOKEN, or MICROSOFT_REFRESH_TOKEN + MICROSOFT_CLIENT_ID
              (+ MICROSOFT_CLIENT_SECRET for confidential apps, MICROSOFT_TENANT, MICROSOFT_SCOPE)
  iCloud      ICLOUD_APPLE_ID + ICLOUD_APP_PASSWORD
  CalDAV      CALDAV_URL + CALDAV_USERNAME + CALDAV_PASSWORD

Or run with --demo to try it on an in-memory calendar.
Docs: https://www.cal-sdk.com/docs/guides/mcp`;

/**
 * Builds the connected accounts from environment variables, keyed by the name tools use
 * to pick one (`google`, `microsoft`, `icloud`, `caldav`). Unset providers are skipped.
 */
export function accountsFromEnv(env: Env): Record<string, CalendarProvider> {
  const accounts: Record<string, CalendarProvider> = {};

  const googleToken =
    env.GOOGLE_ACCESS_TOKEN ??
    refreshFromEnv(env, 'GOOGLE', { tokenUrl: 'https://oauth2.googleapis.com/token' });
  if (googleToken) accounts.google = google({ accessToken: googleToken });

  const tenant = env.MICROSOFT_TENANT ?? 'common';
  const microsoftToken =
    env.MICROSOFT_ACCESS_TOKEN ??
    refreshFromEnv(env, 'MICROSOFT', {
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      // Microsoft wants the scopes again on refresh.
      scope: env.MICROSOFT_SCOPE ?? 'offline_access Calendars.ReadWrite',
    });
  if (microsoftToken) accounts.microsoft = microsoft({ accessToken: microsoftToken });

  if (env.ICLOUD_APPLE_ID && env.ICLOUD_APP_PASSWORD) {
    accounts.icloud = icloud({
      appleId: env.ICLOUD_APPLE_ID,
      appPassword: env.ICLOUD_APP_PASSWORD,
    });
  }

  if (env.CALDAV_URL && env.CALDAV_USERNAME && env.CALDAV_PASSWORD) {
    accounts.caldav = caldav({
      serverUrl: env.CALDAV_URL,
      username: env.CALDAV_USERNAME,
      password: env.CALDAV_PASSWORD,
    });
  }

  return accounts;
}

function refreshFromEnv(
  env: Env,
  prefix: 'GOOGLE' | 'MICROSOFT',
  options: { tokenUrl: string; scope?: string },
) {
  const refreshToken = env[`${prefix}_REFRESH_TOKEN`];
  const clientId = env[`${prefix}_CLIENT_ID`];
  if (!refreshToken || !clientId) return undefined;
  return refreshingToken({
    ...options,
    refreshToken,
    clientId,
    clientSecret: env[`${prefix}_CLIENT_SECRET`],
  });
}

/** Two in-memory calendars with a busy week ahead, for `--demo`. */
export function demoAccounts(now = new Date()): Record<string, CalendarProvider> {
  const day = (offset: number, time: string) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    return { dateTime: `${date.toISOString().slice(0, 10)}T${time}:00Z`, timeZone: 'UTC' };
  };

  return {
    work: mockCalendar({
      calendars: [{ id: 'work', name: 'Work', timeZone: 'UTC' }],
      events: [
        {
          title: 'Standup',
          start: day(1, '09:30'),
          end: day(1, '09:45'),
          recurrence: ['RRULE:FREQ=DAILY;COUNT=10'],
        },
        { title: 'Design review', start: day(1, '14:00'), end: day(1, '15:30') },
        { title: 'Customer call', start: day(2, '11:00'), end: day(2, '12:00') },
      ],
    }),
    personal: mockCalendar({
      calendars: [{ id: 'personal', name: 'Personal', timeZone: 'UTC' }],
      events: [{ title: 'Dentist', start: day(2, '15:00'), end: day(2, '16:00') }],
    }),
  };
}
