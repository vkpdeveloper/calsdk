// Runs the quickstart and loads every provider outside Node. `bun run check:runtime` (repo
// root) bundles this file for browsers and runs it in Deno with no permissions: no files,
// env or network. Biome rules keep Node APIs out of package code; this proves it runs.

import { calcom } from '@calsdk/calcom';
import { caldav } from '@calsdk/caldav';
import { calendly } from '@calsdk/calendly';
import { google } from '@calsdk/google';
import { ics } from '@calsdk/ics';
import { microsoft } from '@calsdk/microsoft';
import { listCalendars } from 'calsdk';
import './index';

// One body that every API's calendar list schemas accept. Cal.com reads a profile and a
// list of event types, Calendly a profile.
const fetch = async (input: RequestInfo | URL) =>
  Response.json({
    items: [{ id: 'g', primary: true, accessRole: 'owner' }],
    value: [{ id: 'm', isDefaultCalendar: true }],
    data: String(input).endsWith('/me') ? { email: 'me@example.com' } : [],
    resource: { uri: 'https://api.calendly.com/users/u', email: 'me@example.com' },
  });

const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';

// One multistatus for every CalDAV request: the root names the calendar home, which holds
// one calendar.
const DAV = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<response><href>/</href><propstat><prop><C:calendar-home-set><href>/c/</href></C:calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/c/home/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`;

for (const calendar of [
  google({ accessToken: 't', fetch }),
  microsoft({ accessToken: 't', fetch }),
  calcom({ accessToken: 't', fetch }),
  calendly({ accessToken: 't', fetch }),
  ics({ url: 'https://example.com/feed.ics', fetch: async () => new Response(FEED) }),
  caldav({
    serverUrl: 'https://dav.example.com/',
    username: 'u',
    password: 'p',
    fetch: async () => new Response(DAV, { status: 207 }),
  }),
]) {
  const { calendars } = await listCalendars({ calendar });
  if (calendars[0]?.isPrimary !== true)
    throw new Error(`${calendar.provider} failed to list calendars.`);
  console.log(`${calendar.provider}: ok`);
}
