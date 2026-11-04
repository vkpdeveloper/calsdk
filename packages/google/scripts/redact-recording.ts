// Removes personal data from a conformance recording before it is committed:
// calendars other than the primary and the test calendar, and the account's email.
//
// bun packages/google/scripts/redact-recording.ts <recording.json> <account email>
import { readFile, writeFile } from 'node:fs/promises';

const [path, email] = process.argv.slice(2);
if (!path || !email) throw new Error('Usage: redact-recording.ts <recording.json> <account email>');

type Interaction = { request: { url: string }; response: { body?: { json?: unknown } } };
const recording: Record<string, Interaction[]> = JSON.parse(await readFile(path, 'utf8'));

for (const interactions of Object.values(recording)) {
  for (const { request, response } of interactions) {
    const body = response.body?.json as { items?: { primary?: boolean; summary?: string }[] };
    if (request.url.includes('/users/me/calendarList') && body?.items) {
      body.items = body.items.filter(
        (item) => item.primary === true || item.summary === 'calsdk conformance',
      );
    }
  }
}
const redacted = JSON.stringify(recording, null, 2).replaceAll(email, 'me@example.com');
await writeFile(path, `${redacted}\n`);
