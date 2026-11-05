/** Edit these to make the page yours. */
export const booking = {
  owner: process.env.BOOKING_OWNER ?? 'Alex Rivera',
  title: process.env.BOOKING_TITLE ?? 'Intro call',
  /** Meeting length in minutes. */
  duration: 30,
  /** How many days ahead people can book. */
  daysAhead: 14,
  /** The owner's working hours. Slots fall inside them. */
  workingHours: {
    start: '09:00',
    end: '17:00',
    timeZone: process.env.BOOKING_TIME_ZONE ?? 'Europe/Berlin',
  },
  get timeZone() {
    return this.workingHours.timeZone;
  },
};
