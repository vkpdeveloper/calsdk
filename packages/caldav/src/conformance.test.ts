import { fileURLToPath } from 'node:url';
import { describeProviderConformance } from '@calsdk/provider-tests';
import { pinWrites } from '../test/pin-writes';
import { caldav } from './caldav-provider';

// Replays test/fixtures/conformance.json, recorded against a local Radicale server with the
// user test:test and a calendar at /test/calsdk/. To re-record, start one
// (`uvx radicale --storage-filesystem-folder=/tmp/radicale` with htpasswd auth), create the
// calendar, and run with CALSDK_RECORD=1.
const CALENDAR_ID = '/test/calsdk/';

pinWrites();

describeProviderConformance({
  name: 'caldav',
  calendarId: CALENDAR_ID,
  createProvider: ({ fetch }) =>
    caldav({ serverUrl: 'http://localhost:5232/', username: 'test', password: 'test', fetch }),
  recording: {
    path: fileURLToPath(new URL('../test/fixtures/conformance.json', import.meta.url)),
    mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
  },
});
