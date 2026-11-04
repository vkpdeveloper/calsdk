// Removes personal data from a recording before it is committed: profile and event type
// fields calsdk does not read, cancel and reschedule links, the user's and organization's
// uuids, and the account's address, name and scheduling page slug.
//
// bun packages/calendly/scripts/redact-recording.ts <recording.json> <address> <name> <slug>
import { readFile, writeFile } from 'node:fs/promises';

const [path, address, name, slug] = process.argv.slice(2);
if (!path || !address || !name || !slug) {
  throw new Error('Usage: redact-recording.ts <recording.json> <address> <name> <slug>');
}

type Interaction = { request: { url: string }; response: { body?: { json?: unknown } } };
const recording: Record<string, Interaction[]> = JSON.parse(await readFile(path, 'utf8'));

const pick = (value: unknown, keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]]));

const uuids = new Set<string>();
for (const interactions of Object.values(recording)) {
  for (const { request, response } of interactions) {
    const body = response.body?.json as { resource?: Record<string, unknown> } | undefined;
    if (!body?.resource) continue;
    const pathname = new URL(request.url).pathname;
    if (pathname === '/users/me') {
      for (const uri of [body.resource.uri, body.resource.current_organization]) {
        if (typeof uri === 'string') uuids.add(uri.slice(uri.lastIndexOf('/') + 1));
      }
      body.resource = pick(body.resource, ['uri', 'email', 'name', 'timezone']);
    } else if (pathname.startsWith('/event_types/')) {
      body.resource = pick(body.resource, ['uri', 'name', 'duration']);
    }
  }
}
// Links that would cancel or reschedule the meeting.
function scrub(value: unknown) {
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  delete record.cancel_url;
  delete record.reschedule_url;
  Object.values(record).forEach(scrub);
}
scrub(recording);

let redacted = JSON.stringify(recording, null, 2);
for (const [index, uuid] of [...uuids].entries()) {
  redacted = redacted.replaceAll(uuid, `00000000-0000-4000-8000-00000000000${index}`);
}
redacted = redacted
  .replaceAll(address, 'me@example.com')
  .replaceAll(encodeURIComponent(address), encodeURIComponent('me@example.com'))
  .replaceAll(name, 'Test User')
  .replaceAll(slug, 'test-user');
await writeFile(path, `${redacted}\n`);
