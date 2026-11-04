import type { Metadata } from 'next';
import { appName, githubUrl, siteUrl } from './shared';

/**
 * Title, description, canonical link and share cards for one page. Next replaces a parent's
 * `openGraph` object instead of merging it, so every page sets the whole thing here. Twitter
 * falls back to these Open Graph fields.
 */
export function pageMetadata({
  title,
  description,
  path,
  image,
  markdownPath,
}: {
  title: string | { absolute: string };
  description: string;
  path: string;
  image?: string;
  /** The page as Markdown, for AI tools and anything else that prefers plain text. */
  markdownPath?: string;
}): Metadata {
  const shareTitle = typeof title === 'string' ? title : title.absolute;
  return {
    title,
    description,
    alternates: {
      canonical: path,
      types: markdownPath ? { 'text/markdown': markdownPath } : undefined,
    },
    openGraph: {
      title: shareTitle,
      description,
      url: path,
      siteName: appName,
      type: path === '/' ? 'website' : 'article',
      locale: 'en_US',
      // Left out entirely when there's no image, so an `opengraph-image` file can supply one.
      ...(image && { images: image }),
    },
    twitter: { card: 'summary_large_image' },
  };
}

export const website = {
  '@type': 'WebSite',
  '@id': `${siteUrl}/#website`,
  name: appName,
  url: siteUrl,
};

/** The library itself, as structured data for search engines and answer engines. */
export const softwareJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    website,
    {
      '@type': 'SoftwareSourceCode',
      '@id': `${siteUrl}/#software`,
      name: appName,
      description:
        'A TypeScript SDK with one API for Google Calendar, Microsoft Outlook, iCloud, Zoho, any CalDAV server, Zoom, Cal.com, Calendly and ICS feeds: list, create, update and delete events, find free time across providers, and sync changes.',
      url: siteUrl,
      codeRepository: githubUrl,
      programmingLanguage: 'TypeScript',
      runtimePlatform: ['Node.js', 'Bun', 'Deno'],
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      keywords: [
        'calendar API',
        'TypeScript calendar SDK',
        'Google Calendar API',
        'Microsoft Graph calendar',
        'Outlook calendar API',
        'iCloud calendar',
        'CalDAV',
        'free/busy',
        'calendar sync',
      ],
    },
  ],
};
