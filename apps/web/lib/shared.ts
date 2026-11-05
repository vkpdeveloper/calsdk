import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'calsdk';
export const appDescription =
  'Events, free time and sync for nine providers, including Google Calendar, Outlook and iCloud, in one typed TypeScript API. Open source, MIT licensed.';

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
