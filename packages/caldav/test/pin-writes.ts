import { beforeEach, expect, vi } from 'vitest';

/**
 * Recorded requests replay by their body, which holds the new event's UID and the time it
 * was written. This fixes both: the time for the whole run, the UIDs per test.
 */
export function pinWrites() {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-30T00:00:00Z') });
  beforeEach(() => {
    const test = expect.getState().currentTestName ?? '';
    let hash = 0;
    for (const char of test) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    let count = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(
      () =>
        `${hash.toString(16).padStart(8, '0')}-0000-4000-8000-${(++count).toString(16).padStart(12, '0')}`,
    );
  });
}
