import { readFile, writeFile } from 'node:fs/promises';
import type { FetchFunction } from '@calsdk/provider-utils';
import { expect } from 'vitest';

export type RecordingMode = 'replay' | 'record';

type Body = { json: unknown } | { text: string };

/** One request and its response. Request headers are never stored: they carry tokens. */
type Interaction = {
  request: { method: string; url: string; body?: Body };
  response: { status: number; headers: Record<string, string>; body?: Body };
};

/** Recorded interactions, keyed by the full name of the test that made them. */
type Recording = Record<string, Interaction[]>;

// Only headers providers read. The rest (cookies, request ids) is noise or sensitive.
const KEPT_RESPONSE_HEADERS = ['content-type', 'etag', 'location', 'retry-after'];

export type RecordingFetch = {
  fetch: FetchFunction;
  /** Writes what was recorded in this run. Tests not run keep their old recordings. No-op in replay. */
  save(): Promise<void>;
};

/**
 * A `fetch` that records real responses to a JSON file, or replays them without a network.
 *
 * Interactions are stored per test, so one test can be re-recorded without touching the
 * rest. A request replays the first unused response recorded for the same method, URL
 * and body in the same test. Review recordings before committing them: response bodies
 * contain whatever the API returned, such as email addresses.
 *
 * @example
 * const recording = createRecordingFetch({
 *   path: 'test/fixtures/google.json',
 *   mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
 * });
 * afterAll(() => recording.save());
 * const calendar = google({ accessToken, fetch: recording.fetch });
 */
export function createRecordingFetch({
  path,
  mode = 'replay',
  fetch = globalThis.fetch,
}: {
  /** JSON file holding the recording. */
  path: string;
  /** Defaults to `'replay'`. */
  mode?: RecordingMode;
  /** The real `fetch`, used when recording. */
  fetch?: FetchFunction;
}): RecordingFetch {
  const recorded: Recording = {};
  const used = new Map<string, Set<Interaction>>();
  let stored: Promise<Recording> | undefined;
  const load = () => {
    stored ??= readFile(path, 'utf8').then(
      (text) => JSON.parse(text) as Recording,
      (error: unknown) => {
        if (mode === 'record') return {};
        throw new Error(`No recording at ${path}. Run once with mode 'record'.`, { cause: error });
      },
    );
    return stored;
  };

  const recordingFetch: FetchFunction = async (input, init) => {
    const test = expect.getState().currentTestName ?? '(outside a test)';
    const request = new Request(input, init);
    const key = {
      method: request.method,
      url: request.url,
      body: toBody(await request.clone().text()),
    };

    if (mode === 'record') {
      const response = await fetch(request);
      const headers: Record<string, string> = {};
      for (const name of KEPT_RESPONSE_HEADERS) {
        const value = response.headers.get(name);
        if (value !== null) headers[name] = value;
      }
      const interactions = recorded[test] ?? [];
      recorded[test] = interactions;
      interactions.push({
        request: key,
        response: {
          status: response.status,
          headers,
          body: toBody(await response.clone().text()),
        },
      });
      return response;
    }

    const usedInTest = used.get(test) ?? new Set();
    used.set(test, usedInTest);
    const match = (await load())[test]?.find(
      (interaction) => !usedInTest.has(interaction) && sameRequest(interaction.request, key),
    );
    if (!match) {
      throw new Error(
        `No recorded response for ${key.method} ${key.url} in "${test}". Re-record with mode 'record'.`,
      );
    }
    usedInTest.add(match);
    const { status, headers, body } = match.response;
    // 204 and 304 responses cannot have a body.
    const text = body === undefined || status === 204 || status === 304 ? null : fromBody(body);
    return new Response(text, { status, headers });
  };

  return {
    fetch: recordingFetch,
    async save() {
      if (mode !== 'record') return;
      const merged = { ...(await load()), ...recorded };
      const sorted = Object.fromEntries(
        Object.keys(merged)
          .sort()
          .map((test) => [test, merged[test]]),
      );
      await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
    },
  };
}

/** JSON bodies are stored parsed, so recordings stay readable and diff well. */
function toBody(text: string): Body | undefined {
  if (text === '') return undefined;
  try {
    return { json: JSON.parse(text) };
  } catch {
    return { text };
  }
}

function fromBody(body: Body): string {
  return 'json' in body ? JSON.stringify(body.json) : body.text;
}

function sameRequest(a: Interaction['request'], b: Interaction['request']): boolean {
  return (
    a.method === b.method &&
    a.url === b.url &&
    (a.body === undefined ? '' : fromBody(a.body)) ===
      (b.body === undefined ? '' : fromBody(b.body))
  );
}
