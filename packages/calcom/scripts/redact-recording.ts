// Removes personal data from a conformance recording before it is committed: event types
// other than the test one, event type and profile fields calsdk does not read (owners carry
// billing ids), avatars, the user's uuid, and the account's address, name and username.
//
// bun packages/calcom/scripts/redact-recording.ts <recording.json> <event type id> <address> <name> <username>
import { readFile, writeFile } from 'node:fs/promises';

const [path, eventTypeId, address, name, username] = process.argv.slice(2);
if (!path || !eventTypeId || !address || !name || !username) {
  throw new Error(
    'Usage: redact-recording.ts <recording.json> <event type id> <address> <name> <username>',
  );
}

type Interaction = { request: { url: string }; response: { body?: { json?: unknown } } };
const recording: Record<string, Interaction[]> = JSON.parse(await readFile(path, 'utf8'));

const EVENT_TYPE_FIELDS = [
  'id',
  'title',
  'slug',
  'lengthInMinutes',
  'lengthInMinutesOptions',
  'recurrence',
];
function pickEventType(item: Record<string, unknown>) {
  return Object.fromEntries(
    EVENT_TYPE_FIELDS.filter((key) => key in item).map((key) => [key, item[key]]),
  );
}

for (const interactions of Object.values(recording)) {
  for (const { request, response } of interactions) {
    const body = response.body?.json as { data?: unknown };
    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith('/v2/event-types') && Array.isArray(body?.data)) {
      body.data = body.data
        .filter((item: { id?: number }) => String(item.id) === eventTypeId)
        .map(pickEventType);
    } else if (pathname.includes('/v2/event-types/') && body?.data) {
      body.data = pickEventType(body.data as Record<string, unknown>);
    }
    if (pathname.endsWith('/v2/me') && body?.data) {
      const { email, name, timeZone } = body.data as Record<string, unknown>;
      body.data = { email, name, timeZone };
    }
  }
}
// Hosts and event type owners carry the profile photo and uuid of the account.
function scrub(value: unknown) {
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  delete record.avatarUrl;
  if (typeof record.uuid === 'string') record.uuid = '00000000-0000-4000-8000-000000000000';
  Object.values(record).forEach(scrub);
}
scrub(recording);

const redacted = JSON.stringify(recording, null, 2)
  .replaceAll(address, 'me@example.com')
  .replaceAll(encodeURIComponent(address), encodeURIComponent('me@example.com'))
  .replaceAll(name, 'Test User')
  .replaceAll(username, 'test-user');
await writeFile(path, `${redacted}\n`);
