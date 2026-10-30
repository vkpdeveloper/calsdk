import { fileURLToPath } from 'node:url';
import { describeProviderConformance } from '@calsdk/provider-tests';
import { calcom } from './calcom-provider';

// A 60-minute event type created for recording and deleted afterwards. Its bookings are the
// test events, so the recording holds no other bookings of the account.
const EVENT_TYPE_ID = '7701778';

// Replays test/fixtures/conformance.json. To re-record, create a 60-minute event type, set
// EVENT_TYPE_ID, and run with CALSDK_RECORD=1 and CALCOM_API_KEY set.
describeProviderConformance({
  name: 'calcom',
  calendarId: EVENT_TYPE_ID,
  createProvider: ({ fetch }) =>
    calcom({ accessToken: process.env.CALCOM_API_KEY ?? 'replay', fetch }),
  recording: {
    path: fileURLToPath(new URL('../test/fixtures/conformance.json', import.meta.url)),
    mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
  },
});
