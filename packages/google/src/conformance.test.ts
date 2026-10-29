import { fileURLToPath } from 'node:url';
import { describeProviderConformance } from '@calsdk/provider-tests';
import { google } from './google-provider';

// A dedicated calendar created for recording and deleted afterwards.
const CALENDAR_ID =
  'a309401a911baa526838fb277c6ac7b3ac5d1b578fc41901e4772415499ef317@group.calendar.google.com';

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
