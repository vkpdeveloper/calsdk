// Runs the quickstart and loads every provider outside Node. `bun run check:runtime` (repo
// root) bundles this file for browsers and runs it in Deno with no permissions: no files,
// env or network. Biome rules keep Node APIs out of package code; this proves it runs.
import { calcom } from '@calsdk/calcom';
import { google } from '@calsdk/google';
import { microsoft } from '@calsdk/microsoft';
import { listCalendars } from 'calsdk';
import './index';

// One body that every API's calendar list schemas accept. Cal.com reads a profile and a
// list of event types.
const fetch = async (input: RequestInfo | URL) =>
  Response.json({
    items: [{ id: 'g', primary: true, accessRole: 'owner' }],
    value: [{ id: 'm', isDefaultCalendar: true }],
    data: String(input).endsWith('/me') ? { email: 'me@example.com' } : [],
  });

for (const calendar of [
  google({ accessToken: 't', fetch }),
  microsoft({ accessToken: 't', fetch }),
  calcom({ accessToken: 't', fetch }),
]) {
  const { calendars } = await listCalendars({ calendar });
  if (calendars[0]?.isPrimary !== true)
    throw new Error(`${calendar.provider} failed to list calendars.`);
  console.log(`${calendar.provider}: ok`);
}
