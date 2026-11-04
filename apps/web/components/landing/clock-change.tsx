import { mockCalendar } from '@calsdk/mock';
import { createEvent, listEvents } from 'calsdk';
import { Fragment } from 'react';

// A weekly 9:30 standup in New York across March 2027: the US changes its clocks on the
// 14th, Europe on the 28th, so for two weeks the gap between the cities is an hour short.
const ZONE = 'America/New_York';
const FIRST_UTC = '2027-03-08T14:30:00Z';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Where each clock change falls between the weekly rows, keyed by the row it follows.
const CHANGES: Record<number, string> = {
  0: 'US clocks go forward, 14 Mar',
  2: 'Europe clocks go forward, 28 Mar',
};

const day = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  day: 'numeric',
  month: 'short',
});
const clock = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
const newYork = clock(ZONE);
const berlin = clock('Europe/Berlin');

type Row = { day: string; newYork: string; berlin: string };

/**
 * Both sides are computed at build time. calsdk's side is the real mock provider expanding
 * the series; the other side adds a week at a time to one UTC instant, as an app that
 * saved a timestamp would.
 */
async function rows() {
  const calendar = mockCalendar();
  await createEvent({
    calendar,
    event: {
      title: 'Standup',
      start: { dateTime: '2027-03-08T09:30:00', timeZone: ZONE },
      end: { dateTime: '2027-03-08T09:45:00', timeZone: ZONE },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4'],
    },
  });
  const { events } = await listEvents({
    calendar,
    timeMin: '2027-03-01T00:00:00Z',
    timeMax: '2027-04-05T00:00:00Z',
  });
  const toRow = (instant: Date): Row => ({
    day: day.format(instant),
    newYork: newYork.format(instant),
    berlin: berlin.format(instant),
  });
  const kept = events.flatMap(({ start }) =>
    start.dateTime ? [toRow(new Date(start.dateTime))] : [],
  );
  const drifted = kept.map((_, week) => toRow(new Date(Date.parse(FIRST_UTC) + week * WEEK_MS)));
  return { kept, drifted };
}

export async function ClockChange() {
  const { kept, drifted } = await rows();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Saved as a UTC time" saved={`'${FIRST_UTC}'`} rows={drifted} />
      <Card
        title="Saved as time and zone (calsdk)"
        saved={`{ dateTime: '2027-03-08T09:30:00', timeZone: '${ZONE}' }`}
        rows={kept}
        highlight
      />
    </div>
  );
}

function Card({
  title,
  saved,
  rows,
  highlight,
}: {
  title: string;
  saved: string;
  rows: Row[];
  highlight?: boolean;
}) {
  const first = rows[0];
  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border bg-panel ${highlight ? 'border-accent-blue/60' : 'border-line'}`}
    >
      <div className="border-b border-line px-4 py-3">
        <div className="text-sm font-medium text-white">{title}</div>
        <code className="mt-1 block font-mono text-xs break-words text-neutral-400">{saved}</code>
      </div>
      {/* Fixed columns, so both cards put each city at the same x and rows compare across. */}
      <table className="w-full table-fixed text-sm tabular-nums">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[38%]" />
          <col />
        </colgroup>
        <thead>
          <tr className="text-left text-xs text-neutral-400">
            <th className="px-3 pt-3 pb-2 sm:px-4 font-normal">Monday</th>
            <th className="px-3 pt-3 pb-2 sm:px-4 font-normal">New York</th>
            <th className="px-3 pt-3 pb-2 sm:px-4 font-normal">Berlin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const late = row.newYork !== first?.newYork;
            // On calsdk's side Berlin moves while New York holds; say why where it happens.
            const shifted = highlight && row.berlin !== first?.berlin;
            const change = CHANGES[i - 1];
            return (
              <Fragment key={row.day}>
                {change && (
                  <tr className="border-t border-dashed border-neutral-700">
                    <td colSpan={3} className="px-3 py-1.5 sm:px-4 text-xs text-neutral-400">
                      {change}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-line">
                  <td className="px-3 py-3 sm:px-4 text-neutral-400">{row.day}</td>
                  <td
                    className={`px-3 py-3 sm:px-4 font-mono ${late ? 'text-red-400' : 'text-white'}`}
                  >
                    {row.newYork}
                    {late && <Note>an hour late</Note>}
                  </td>
                  <td className="px-3 py-3 sm:px-4 font-mono text-neutral-300">
                    {row.berlin}
                    {shifted && <Note className="text-neutral-400">US changed first</Note>}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Note({ children, className }: { children: string; className?: string }) {
  return (
    <span className={`block font-sans text-xs sm:ml-2 sm:inline ${className ?? ''}`}>
      {children}
    </span>
  );
}
