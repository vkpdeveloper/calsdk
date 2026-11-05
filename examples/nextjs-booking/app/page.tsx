import { isDemo } from '@/lib/calendar';
import { booking } from '@/lib/config';
import { openSlots } from '@/lib/slots';
import { Picker } from './picker';

// Slots come from the live calendar on every request.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const slots = await openSlots();

  return (
    <main className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-6 sm:py-16 md:grid-cols-[18rem_1fr]">
      <header className="md:sticky md:top-16 md:self-start">
        <p className="text-sm text-neutral-500">{booking.owner}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{booking.title}</h1>
        <dl className="mt-6 space-y-2 text-sm text-neutral-600">
          <div className="flex gap-2">
            <dt className="text-neutral-400">Length</dt>
            <dd>{booking.duration} minutes</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-neutral-400">Times in</dt>
            <dd>{booking.timeZone.replace('_', ' ')}</dd>
          </div>
        </dl>
        {isDemo && (
          <p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Demo calendar. Set your Google credentials to take real bookings.
          </p>
        )}
      </header>
      <Picker slots={slots} timeZone={booking.timeZone} />
    </main>
  );
}
