import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRecordingFetch } from './recording-fetch';

const url = 'https://calendar.test/events/1';
const get = (fetch: typeof globalThis.fetch, target = url) =>
  fetch(target, { headers: { authorization: 'Bearer secret' } });

describe('createRecordingFetch', () => {
  it('records responses without credentials and replays them offline', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'calsdk-')), 'recording.json');
    await writeFile(path, JSON.stringify({ 'another test': [] }));
    const real = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { id: '1' },
        { headers: { etag: '"v1"', 'set-cookie': 'session=secret', 'x-request-id': 'abc' } },
      ),
    );

    const recorder = createRecordingFetch({ path, mode: 'record', fetch: real });
    expect(await (await get(recorder.fetch)).json()).toEqual({ id: '1' });
    await recorder.save();

    const saved = await readFile(path, 'utf8');
    expect(saved).not.toContain('secret');
    expect(Object.keys(JSON.parse(saved))).toEqual([
      'another test',
      'createRecordingFetch > records responses without credentials and replays them offline',
    ]);

    const replay = createRecordingFetch({ path, fetch: real });
    const response = await get(replay.fetch);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"v1"');
    expect(await response.json()).toEqual({ id: '1' });
    expect(real).toHaveBeenCalledTimes(1);

    // Each recorded response replays once, and only for the same request.
    await expect(get(replay.fetch)).rejects.toThrow(/No recorded response for GET/);
    await expect(get(replay.fetch, `${url}?x=1`)).rejects.toThrow(/No recorded response/);
  });

  it('matches requests by body and replays empty responses', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'calsdk-')), 'recording.json');
    const real = vi.fn<typeof globalThis.fetch>(async (input, init) =>
      (await new Request(input, init).text()) === '{"title":"a"}'
        ? new Response(null, { status: 204 })
        : Response.json({}),
    );
    const post = (fetch: typeof globalThis.fetch, title: string) =>
      fetch(url, { method: 'POST', body: JSON.stringify({ title }) });

    const recorder = createRecordingFetch({ path, mode: 'record', fetch: real });
    await post(recorder.fetch, 'b');
    await post(recorder.fetch, 'a');
    await recorder.save();

    const replay = createRecordingFetch({ path });
    expect((await post(replay.fetch, 'a')).status).toBe(204);
    expect((await post(replay.fetch, 'b')).status).toBe(200);
  });

  it('never stores credentials passed in the URL', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'calsdk-')), 'recording.json');
    const real = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
    const recorder = createRecordingFetch({ path, mode: 'record', fetch: real });
    await get(recorder.fetch, `${url}?access_token=secret&q=1`);
    await recorder.save();
    expect(await readFile(path, 'utf8')).not.toContain('secret');

    const replay = createRecordingFetch({ path });
    expect((await get(replay.fetch, `${url}?access_token=other&q=1`)).status).toBe(200);
    await expect(get(replay.fetch, `${url}?access_token=secret&q=2`)).rejects.toThrow(
      /access_token=REDACTED&q=2/,
    );
  });

  it('only replays a conditional response for the same condition', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'calsdk-')), 'recording.json');
    const real = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 412 }));
    const recorder = createRecordingFetch({ path, mode: 'record', fetch: real });
    await recorder.fetch(url, { method: 'PATCH', headers: { 'if-match': '"v1"' } });
    await recorder.save();

    const replay = createRecordingFetch({ path });
    await expect(replay.fetch(url, { method: 'PATCH' })).rejects.toThrow(/No recorded response/);
    const response = await replay.fetch(url, { method: 'PATCH', headers: { 'if-match': '"v1"' } });
    expect(response.status).toBe(412);
  });

  it('keeps recordings saved by another recorder in the meantime', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'calsdk-')), 'recording.json');
    const recorder = createRecordingFetch({
      path,
      mode: 'record',
      fetch: async () => Response.json({}),
    });
    await get(recorder.fetch);
    await recorder.save();
    const saved = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...saved, 'another file > its test': [] }));
    await recorder.save();
    expect(Object.keys(JSON.parse(await readFile(path, 'utf8')))).toEqual([
      'another file > its test',
      'createRecordingFetch > keeps recordings saved by another recorder in the meantime',
    ]);
  });

  it('explains how to create a missing recording', async () => {
    const replay = createRecordingFetch({ path: join(tmpdir(), 'calsdk-missing.json') });
    await expect(get(replay.fetch)).rejects.toThrow(/Run once with mode 'record'/);
  });
});
