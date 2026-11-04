import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'calsdk';
export const appDescription =
  'Events, free time and sync for nine providers, including Google Calendar, Outlook and iCloud, in one typed TypeScript API. Open source, MIT licensed.';

// Absolute URLs (canonical links, Open Graph images, the sitemap) need the public origin.
// Vercel sets this to the production domain, a custom one once it's added, for every build.
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
export const siteUrl = productionHost ? `https://${productionHost}` : 'http://localhost:3000';

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
