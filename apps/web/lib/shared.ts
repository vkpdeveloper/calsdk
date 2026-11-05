import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'calsdk';
// The landing page's lead, also its meta description, its JSON-LD description and the llms.txt
// summary, so every place that says what calsdk is says the same thing.
export const appDescription =
  'calsdk is an open source TypeScript library with one API for events, free time and sync across nine calendars, including Google Calendar, Outlook and iCloud.';

// Absolute URLs (canonical links, Open Graph images, the sitemap) use the public origin in every
// build, so previews and local builds never present themselves as the real site. It's www because
// the bare domain redirects here.
export const siteUrl = 'https://www.cal-sdk.com';

// Google Analytics 4 web stream for www.cal-sdk.com.
export const gaMeasurementId = 'G-M7MHD0NEWY';

export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'vkpdeveloper',
  repo: 'calsdk',
  branch: 'main',
};

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
export const npmUrl = 'https://www.npmjs.com/org/cal-sdk';

// The byline on blog posts.
export const author = { name: 'Vaibhav Pathak', url: 'https://x.com/vkpdeveloper' };

/** A `YYYY-MM-DD` date or ISO timestamp as "Nov 6, 2026". UTC, so the server's time zone can't shift the day. */
export function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
