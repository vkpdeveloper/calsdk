// Removes personal data from a conformance recording before it is committed:
// calendars other than the default and the test calendar, the account's address and name.
//
// bun packages/microsoft/scripts/redact-recording.ts <recording.json> <account address> <account name>
import { readFile, writeFile } from 'node:fs/promises';

const [path, address, name] = process.argv.slice(2);
if (!path || !address || !name) {
  throw new Error('Usage: redact-recording.ts <recording.json> <account address> <account name>');
}

type Interaction = { request: { url: string }; response: { body?: { json?: unknown } } };
const recording: Record<string, Interaction[]> = JSON.parse(await readFile(path, 'utf8'));

for (const interactions of Object.values(recording)) {
  for (const { request, response } of interactions) {
    const body = response.body?.json as {
      value?: { isDefaultCalendar?: boolean; name?: string }[];
    };
    if (new URL(request.url).pathname.endsWith('/me/calendars') && body?.value) {
      body.value = body.value.filter(
        (item) => item.isDefaultCalendar === true || item.name === 'calsdk conformance',
      );
    }
  }
}
const redacted = JSON.stringify(recording, null, 2)
  .replaceAll(address, 'me@example.com')
  .replaceAll(encodeURIComponent(address), encodeURIComponent('me@example.com'))
  .replaceAll(name, 'Test User');
await writeFile(path, `${redacted}\n`);
