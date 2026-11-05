import { createEvent, findFreeTime, listEvents, updateEvent } from '@cal-sdk/core';
import { mockCalendar } from '@cal-sdk/mock';

// Two in-memory calendars stand in for real accounts, so nothing here needs a login.
// In a real app you'd create `google({ accessToken })` or `microsoft({ accessToken })` instead,
// in server code, since a token gives full access to someone's calendar. The calls stay the same.
const timeZone = 'America/New_York';
const at = (day: number, time: string) => ({
  dateTime: `2026-11-${String(day).padStart(2, '0')}T${time}:00-05:00`,
  timeZone,
});

const work = mockCalendar({
  events: [
    { title: 'Design review', start: at(10, '14:00'), end: at(10, '15:30') },
    { title: 'Customer call', start: at(12, '11:00'), end: at(12, '12:00') },
  ],
});
const home = mockCalendar({
  events: [{ title: 'Dentist', start: at(11, '12:30'), end: at(11, '13:30') }],
});

// A standup every weekday, then Wednesday's moved half an hour later. Only that one changes.
const { event: standup } = await createEvent({
  calendar: work,
  event: {
    title: 'Standup',
    start: at(9, '09:30'),
    end: at(9, '09:45'),
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  },
});

const week = { timeMin: '2026-11-09T00:00:00-05:00', timeMax: '2026-11-14T00:00:00-05:00' };
const workWeek = await listEvents({ calendar: work, ...week, expandRecurring: true });
const wednesday = workWeek.events.find(
  (event) => event.seriesId === standup.id && event.start.dateTime?.startsWith('2026-11-11'),
);
if (wednesday) {
  await updateEvent({
    calendar: work,
    eventId: wednesday.id,
    patch: { start: at(11, '10:00'), end: at(11, '10:15') },
  });
}

// Every hour-long slot when both calendars are free, inside working hours.
const { slots } = await findFreeTime({
  calendars: [{ calendar: work }, { calendar: home }],
  ...week,
  duration: 60,
  slotInterval: 60,
  workingHours: { start: '09:00', end: '17:00', timeZone },
});

const sources = [
  { calendar: work, name: 'Work', color: '#4f7cff' },
  { calendar: home, name: 'Home', color: '#f59e0b' },
];
const items: { start: string; title: string; color: string; free?: boolean }[] = [];
for (const { calendar, name, color } of sources) {
  const { events } = await listEvents({ calendar, ...week, expandRecurring: true });
  for (const event of events) {
    // An all-day event has only a date. Place it at midnight here, not in UTC, so it keeps its day.
    const start = event.start.dateTime ?? `${event.start.date}T00:00:00-05:00`;
    items.push({ start, title: `${event.title} (${name})`, color });
  }
}
for (const slot of slots)
  items.push({ start: slot.start, title: 'Free for an hour', color: '#86efac', free: true });

render(items);

function render(list: typeof items) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });

  const byDay = new Map<string, typeof list>();
  for (const item of list.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const key = day.format(new Date(item.start));
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const week = document.querySelector('#week');
  if (!week) return;
  week.replaceChildren();
  for (const dayItems of byDay.values()) {
    const column = document.createElement('section');
    column.className = 'day';
    const heading = document.createElement('h2');
    heading.textContent = dayName.format(new Date(dayItems[0]?.start ?? ''));
    column.append(heading);
    for (const item of dayItems) {
      const row = document.createElement('div');
      row.className = item.free ? 'item free' : 'item';
      row.style.setProperty('--color', item.color);
      const when = document.createElement('time');
      when.textContent = time.format(new Date(item.start));
      row.append(when, item.title);
      column.append(row);
    }
    week.append(column);
  }
}
