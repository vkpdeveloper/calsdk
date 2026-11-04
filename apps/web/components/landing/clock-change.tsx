import { mockCalendar } from '@calsdk/mock';
import { createEvent, listEvents } from 'calsdk';

// A weekly 9:30 standup in New York across March 2027: the US changes its clocks on the
// 14th, Europe on the 28th, so for two weeks the gap between the cities is an hour short.
const ZONE = 'America/New_York';
const FIRST_UTC = '2027-03-08T14:30:00Z';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const day = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  weekday: 'short',
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
        title="Saved by calsdk"
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
  const home = rows[0]?.newYork;
  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border bg-panel ${highlight ? 'border-accent-blue/60' : 'border-line'}`}
    >
      <div className="border-b border-line px-4 py-3">
        <div className="text-sm font-medium text-white">{title}</div>
        <code className="mt-1 block font-mono text-xs break-words text-neutral-400">{saved}</code>
      </div>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-neutral-500">
            <th className="px-4 pt-3 pb-2 font-normal">Standup</th>
            <th className="px-4 pt-3 pb-2 font-normal">New York</th>
            <th className="px-4 pt-3 pb-2 font-normal">Berlin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const late = row.newYork !== home;
            return (
              <tr key={row.day} className="border-t border-line">
                <td className="px-4 py-3 text-neutral-400">{row.day}</td>
                <td className={`px-4 py-3 font-mono ${late ? 'text-red-400' : 'text-white'}`}>
                  {row.newYork}
                  {late && <span className="ml-2 font-sans text-xs">an hour late</span>}
                </td>
                <td className="px-4 py-3 font-mono text-neutral-300">{row.berlin}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
