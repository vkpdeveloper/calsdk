// Removes personal data and secrets from a recording before it is committed: meeting fields
// calsdk does not read (such as the host's start link and the passcodes), the passcode in
// join links, the account's meeting uuids, and the host's address.
//
// bun packages/zoom/scripts/redact-recording.ts <recording.json> <address>
import { readFile, writeFile } from 'node:fs/promises';

const [path, address] = process.argv.slice(2);
if (!path || !address) throw new Error('Usage: redact-recording.ts <recording.json> <address>');

type Body = { json?: unknown };
type Interaction = { request: { url: string; body?: Body }; response: { body?: Body } };
const recording: Record<string, Interaction[]> = JSON.parse(await readFile(path, 'utf8'));

const MEETING_FIELDS = [
  'id',
  'uuid',
  'topic',
  'type',
  'start_time',
  'duration',
  'timezone',
  'agenda',
  'created_at',
  'join_url',
  'host_email',
  'recurrence',
  'occurrences',
  'settings',
];

function pick(value: unknown, keys: string[]): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

const uuids = new Set<string>();
function meeting(value: unknown) {
  const kept = pick(value, MEETING_FIELDS);
  if (typeof kept.uuid === 'string') uuids.add(kept.uuid);
  if (typeof kept.join_url === 'string') kept.join_url = kept.join_url.replace(/\?.*$/, '');
  if (kept.settings) kept.settings = pick(kept.settings, ['meeting_invitees']);
  return kept;
}

for (const interactions of Object.values(recording)) {
  for (const { request, response } of interactions) {
    const body = response.body?.json;
    if (typeof body !== 'object' || body === null) continue;
    const pathname = new URL(request.url).pathname;
    if (pathname === '/v2/users/me') {
      response.body = { json: pick(body, ['email', 'timezone']) };
    } else if (pathname === '/v2/users/me/meetings' && request.body === undefined) {
      const list = pick(body, ['meetings', 'next_page_token']);
      list.meetings = (list.meetings as unknown[]).map(meeting);
      response.body = { json: list };
    } else if ('id' in body) {
      response.body = { json: meeting(body) };
    }
  }
}

let redacted = JSON.stringify(recording, null, 2);
for (const [index, uuid] of [...uuids].entries()) {
  redacted = redacted.replaceAll(uuid, `meeting-uuid-${index}`);
}
redacted = redacted
  .replaceAll(address, 'me@example.com')
  .replaceAll(encodeURIComponent(address), encodeURIComponent('me@example.com'));
await writeFile(path, `${redacted}\n`);
