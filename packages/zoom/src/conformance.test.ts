import { fileURLToPath } from 'node:url';
import { describeProviderConformance } from '@calsdk/provider-tests';
import { zoom } from './zoom-provider';

// Replays test/fixtures/conformance.json. To re-record, run with CALSDK_RECORD=1 and
// ZOOM_TOKEN set to a token with the meeting:read and meeting:write scopes, then redact
// the recording with scripts/redact-recording.ts. The recurring tests are skipped, as
// Zoom cannot rename one meeting of a series: zoom-provider.test.ts covers series.
describeProviderConformance({
  name: 'zoom',
  createProvider: ({ fetch }) => zoom({ accessToken: process.env.ZOOM_TOKEN ?? 'replay', fetch }),
  recording: {
    path: fileURLToPath(new URL('../test/fixtures/conformance.json', import.meta.url)),
    mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
  },
});
