import { generateOGImage } from 'fumadocs-ui/og';
import { appName } from '@/lib/shared';

// The card shown when someone shares the home page. Same template as the docs pages' cards.
export const alt = 'calsdk: every calendar, one API';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return generateOGImage({
    title: 'Every calendar. One API.',
    description:
      'Events, free time and sync for Google Calendar, Outlook, iCloud and six more, in one typed TypeScript API.',
    site: appName,
    ...size,
  });
}
