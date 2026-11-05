import { generateOGImage } from 'fumadocs-ui/og';
import { appName } from '@/lib/shared';

// The card shown when someone shares the blog index. Same template as the other pages' cards.
export const alt = 'The calsdk blog';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return generateOGImage({
    title: 'Blog',
    description: 'How Google Calendar, Outlook and CalDAV really behave.',
    site: appName,
    ...size,
  });
}
