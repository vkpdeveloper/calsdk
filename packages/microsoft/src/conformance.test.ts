import { fileURLToPath } from 'node:url';
import { describeProviderConformance } from '@calsdk/provider-tests';
import { vi } from 'vitest';
import { microsoft } from './microsoft-provider';

// A dedicated calendar created for recording and deleted afterwards.
const CALENDAR_ID = 'AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0AfpKkyEv5x0_7_nu4Sv5u3wAJDb-C5AAA';

// An initial sync covers a window around today, so today is fixed for the recorded URLs.
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2029-12-01T00:00:00Z') });

// Replays test/fixtures/conformance.json. To re-record, create a test calendar, set
// CALENDAR_ID, and run with CALSDK_RECORD=1 and MICROSOFT_ACCESS_TOKEN set.
describeProviderConformance({
  name: 'microsoft',
  calendarId: CALENDAR_ID,
  createProvider: ({ fetch }) =>
    microsoft({ accessToken: process.env.MICROSOFT_ACCESS_TOKEN ?? 'replay', fetch }),
  recording: {
    path: fileURLToPath(new URL('../test/fixtures/conformance.json', import.meta.url)),
    mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
  },
});
