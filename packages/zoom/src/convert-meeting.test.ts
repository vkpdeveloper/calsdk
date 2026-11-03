import { expect, it } from 'vitest';
import { seriesMinutes } from './convert-meeting';

it('gives a series the length most of its meetings have, the earliest on a tie', () => {
  const series = (durations: number[]) => ({
    id: 1,
    type: 8,
    occurrences: durations.map((duration, index) => ({
      occurrence_id: String(index),
      start_time: '2030-01-01T10:00:00Z',
      duration,
    })),
  });
  expect(seriesMinutes(series([45, 15, 15]))).toBe(15);
  expect(seriesMinutes(series([15, 30, 30, 15]))).toBe(15);
});
