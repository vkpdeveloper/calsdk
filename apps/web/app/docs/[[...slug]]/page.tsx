import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/notebook/page';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { JsonLd } from '@/components/json-ld';
import { getMDXComponents } from '@/components/mdx';
import { contentDates } from '@/lib/content-dates';
import { breadcrumbs, faqJsonLd, organization, pageMetadata, website } from '@/lib/seo';
import {
  appDescription,
  appName,
  formatDate,
  getPageImageUrl,
  getPageMarkdownUrl,
  gitConfig,
  githubUrl,
  siteUrl,
} from '@/lib/shared';
import { source } from '@/lib/source';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  const dates = pageDates(page);
  const crumbs = pageCrumbs(page);

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <JsonLd data={docsJsonLd(page)} />
      <Breadcrumb crumbs={crumbs} className="mb-3 text-sm text-fd-muted-foreground" />
      {/* Phones: title, description, actions. Wider: the actions sit on the title's row. */}
      <div className="mb-8 flex flex-col gap-y-3 sm:grid sm:grid-cols-[1fr_auto] sm:items-center sm:gap-x-4">
        <DocsTitle className="sm:col-start-1 sm:row-start-1">{page.data.title}</DocsTitle>
        <DocsDescription className="mb-0 sm:col-span-2">{page.data.description}</DocsDescription>
        <div className="flex items-center gap-2 sm:col-start-2 sm:row-start-1">
          <MarkdownCopyButton markdownUrl={markdownUrl}>Copy page</MarkdownCopyButton>
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/web/content/docs/${page.path}`}
          />
        </div>
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
      {dates && (
        <p className="mt-10 text-sm text-fd-muted-foreground">
          Last updated <time dateTime={dates.modified}>{formatDate(dates.modified)}</time>
        </p>
      )}
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return pageMetadata({
    // `metaTitle` is the search result title, when the page's own title is too short to stand alone.
    title: page.data.metaTitle ?? page.data.title,
    description: page.data.description ?? appDescription,
    path: page.url,
    image: getPageImageUrl(page).url,
    markdownPath: `${page.url}.md`,
    dates: pageDates(page),
  });
}

type DocsPageData = NonNullable<ReturnType<typeof source.getPage>>;

function pageDates(page: DocsPageData) {
  return contentDates(`content/docs/${page.path}`);
}

/** The trail from the home page to this page, shown above the title and in the JSON-LD. */
function pageCrumbs(page: DocsPageData) {
  return [
    { name: appName, path: '/' },
    { name: 'Docs', path: '/docs' },
    ...(page.slugs.length > 0 ? [{ name: page.data.title, path: page.url }] : []),
  ];
}

function docsJsonLd(page: DocsPageData) {
  const url = `${siteUrl}${page.url}`;
  const dates = pageDates(page);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      website,
      organization,
      {
        '@type': 'TechArticle',
        '@id': `${url}#article`,
        headline: page.data.title,
        description: page.data.description,
        url,
        image: `${siteUrl}${getPageImageUrl(page).url}`,
        inLanguage: 'en',
        datePublished: dates?.published,
        dateModified: dates?.modified,
        author: { '@id': organization['@id'] },
        publisher: { '@id': organization['@id'] },
        isPartOf: { '@id': website['@id'] },
        about: { '@type': 'SoftwareSourceCode', name: appName, codeRepository: githubUrl },
      },
      breadcrumbs(pageCrumbs(page)),
      ...faqJsonLd(page.data.structuredData, page.slugs.join('/') === 'faq'),
    ],
  };
}
