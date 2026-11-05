import type { StructuredData } from 'fumadocs-core/mdx-plugins';
import type { Metadata } from 'next';
import type { ContentDates } from './content-dates';
import { appDescription, appName, githubUrl, npmUrl, siteUrl } from './shared';

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
  type = 'article',
  dates,
}: {
  title: string | { absolute: string };
  description: string;
  path: string;
  image?: string;
  /** The page as Markdown, for AI tools and anything else that prefers plain text. */
  markdownPath?: string;
  /** `website` for the landing page and listings, `article` for anything you read. */
  type?: 'website' | 'article';
  dates?: ContentDates;
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
      locale: 'en_US',
      // Left out entirely when there's no image, so an `opengraph-image` file can supply one.
      ...(image && { images: image }),
      ...(type === 'article'
        ? { type, publishedTime: dates?.published, modifiedTime: dates?.modified }
        : { type }),
    },
    twitter: { card: 'summary_large_image' },
  };
}

export const website = {
  '@type': 'WebSite',
  '@id': `${siteUrl}/#website`,
  name: appName,
  url: siteUrl,
  publisher: { '@id': `${siteUrl}/#organization` },
};

/** Who publishes the site and the docs: the calsdk project. */
export const organization = {
  '@type': 'Organization',
  '@id': `${siteUrl}/#organization`,
  name: appName,
  url: siteUrl,
  logo: `${siteUrl}/apple-icon.png`,
  sameAs: [githubUrl, npmUrl, 'https://www.npmjs.com/package/@cal-sdk/core'],
};

/** Every crumb from the home page down to the current page, as a BreadcrumbList. */
export function breadcrumbs(crumbs: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.path === '/' ? siteUrl : `${siteUrl}${crumb.path}`,
    })),
  };
}

/**
 * A page's questions as FAQPage data, built from the page itself so the two can't drift. The
 * questions are the headings after a `## FAQ` heading, or every heading on a page that is all
 * questions, and the text under each is its answer. Returns nothing to spread when there are none.
 */
export function faqJsonLd({ headings, contents }: StructuredData, wholePage = false) {
  const start = wholePage ? 0 : headings.findIndex((heading) => heading.content === 'FAQ') + 1;
  const questions = start === 0 && !wholePage ? [] : headings.slice(start);
  if (questions.length === 0) return [];

  return [
    {
      '@type': 'FAQPage',
      mainEntity: questions.map((heading) => ({
        '@type': 'Question',
        name: heading.content,
        acceptedAnswer: {
          '@type': 'Answer',
          text: contents
            .filter((block) => block.heading === heading.id)
            .map((block) => block.content)
            .join(' ')
            // Search text keeps inline code backticks; an answer is plain text.
            .replaceAll('`', ''),
        },
      })),
    },
  ];
}

/** The landing page's title, also the name of its WebPage node below. */
export const homeTitle = 'calsdk: one TypeScript API for every calendar';

/** The landing page and the library itself, as structured data for search and answer engines. */
export const softwareJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    website,
    organization,
    {
      '@type': 'WebPage',
      '@id': `${siteUrl}/#webpage`,
      url: siteUrl,
      name: homeTitle,
      description: appDescription,
      isPartOf: { '@id': website['@id'] },
      about: { '@id': `${siteUrl}/#software` },
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': `${siteUrl}/#software`,
      name: appName,
      description: appDescription,
      author: { '@id': organization['@id'] },
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

/**
 * A page as Markdown. The canonical link header points search engines at the HTML page, so the
 * Markdown copy never competes with it in results.
 */
export function markdownResponse(markdown: string, path: string) {
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Link: `<${siteUrl}${path}>; rel="canonical"`,
    },
  });
}
