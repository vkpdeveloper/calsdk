'use client';

import { useActionState, useState } from 'react';
import { type BookingState, book } from './actions';

export function Picker({ slots, timeZone }: { slots: string[]; timeZone: string }) {
  // A fixed locale and zone, so the server and the browser render the same text.
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  const dayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });

  const days = new Map<string, string[]>();
  for (const slot of slots) {
    const key = dayKey.format(new Date(slot));
    days.set(key, [...(days.get(key) ?? []), slot]);
  }
  const dayKeys = [...days.keys()];

  const [day, setDay] = useState(dayKeys[0]);
  const [start, setStart] = useState<string>();
  const [state, action, pending] = useActionState<BookingState, FormData>(book, { status: 'idle' });

  if (state.status === 'booked') {
    const when = new Date(state.start);
    return (
      <section className="self-start rounded-xl border border-neutral-200 p-6">
        <h2 className="text-xl font-semibold">You're booked</h2>
        <p className="mt-2 text-neutral-600">
          {dayLabel.format(when)} at {timeLabel.format(when)}. An invite is on its way to{' '}
          {state.email}.
        </p>
      </section>
    );
  }

  if (dayKeys.length === 0) {
    return <p className="text-neutral-600">No open times right now. Check back soon.</p>;
  }

  const selectedDay = day && days.has(day) ? day : dayKeys[0];

  return (
    <section className="min-w-0">
      <h2 className="text-sm font-medium text-neutral-500">Pick a day</h2>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {dayKeys.map((key) => {
          const first = days.get(key)?.[0] ?? '';
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setDay(key);
                setStart(undefined);
              }}
              aria-pressed={key === selectedDay}
              className="min-h-11 rounded-lg border border-neutral-200 px-2 py-2 text-sm hover:border-neutral-400 aria-pressed:border-neutral-900 aria-pressed:bg-neutral-900 aria-pressed:text-white"
            >
              {dayLabel.format(new Date(first))}
            </button>
          );
        })}
      </div>

      <h2 className="mt-8 text-sm font-medium text-neutral-500">Pick a time</h2>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {(days.get(selectedDay ?? '') ?? []).map((slot) => (
          <button
            key={slot}
            type="button"
            onClick={() => setStart(slot)}
            aria-pressed={slot === start}
            className="min-h-11 rounded-lg border border-neutral-200 px-2 py-2 text-sm tabular-nums hover:border-neutral-400 aria-pressed:border-neutral-900 aria-pressed:bg-neutral-900 aria-pressed:text-white"
          >
            {timeLabel.format(new Date(slot))}
          </button>
        ))}
      </div>

      {start && (
        <form action={action} className="mt-8 grid max-w-md gap-3">
          <input type="hidden" name="start" value={start} />
          <label className="grid gap-1 text-sm">
            Name
            <input
              name="name"
              required
              autoComplete="name"
              className="min-h-11 rounded-lg border border-neutral-300 px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="min-h-11 rounded-lg border border-neutral-300 px-3"
            />
          </label>
          {state.status === 'error' && <p className="text-sm text-red-700">{state.message}</p>}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white disabled:opacity-60"
          >
            {pending
              ? 'Booking...'
              : `Book ${dayLabel.format(new Date(start))}, ${timeLabel.format(new Date(start))}`}
          </button>
        </form>
      )}
    </section>
  );
}
