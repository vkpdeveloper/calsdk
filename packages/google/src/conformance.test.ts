import { fileURLToPath } from 'node:url';
import { describeProviderConformance } from '@calsdk/provider-tests';
import { google } from './google-provider';

// A dedicated calendar created for recording and deleted afterwards.
const CALENDAR_ID =
  'ad710f205f415aa90281028b3d83fae05c4a7bba7bcb17126acbcc734e53c94d@group.calendar.google.com';

// Replays test/fixtures/conformance.json. To re-record, create a test calendar, set
// CALENDAR_ID, and run with CALSDK_RECORD=1 and GOOGLE_ACCESS_TOKEN set.
describeProviderConformance({
  name: 'google',
  calendarId: CALENDAR_ID,
  createProvider: ({ fetch }) =>
    google({ accessToken: process.env.GOOGLE_ACCESS_TOKEN ?? 'replay', fetch }),
  recording: {
    path: fileURLToPath(new URL('../test/fixtures/conformance.json', import.meta.url)),
    mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
  },
});
