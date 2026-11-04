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
import { JsonLd } from '@/components/json-ld';
import { getMDXComponents } from '@/components/mdx';
import { pageMetadata, website } from '@/lib/seo';
import {
  appDescription,
  appName,
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

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <JsonLd data={docsJsonLd(page)} />
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
    // The overview's own title is just "Overview", which says nothing in search results.
    title: page.slugs.length === 0 ? { absolute: `${appName} docs` } : page.data.title,
    description: page.data.description ?? appDescription,
    path: page.url,
    image: getPageImageUrl(page).url,
    markdownPath: `${page.url}.md`,
  });
}

function docsJsonLd(page: NonNullable<ReturnType<typeof source.getPage>>) {
  const url = `${siteUrl}${page.url}`;
  const crumbs = [
    { name: appName, url: siteUrl },
    { name: 'Docs', url: `${siteUrl}/docs` },
    ...(page.slugs.length > 0 ? [{ name: page.data.title, url }] : []),
  ];
  const graph: object[] = [
    website,
    {
      '@type': 'TechArticle',
      '@id': `${url}#article`,
      headline: page.data.title,
      description: page.data.description,
      url,
      image: `${siteUrl}${getPageImageUrl(page).url}`,
      inLanguage: 'en',
      isPartOf: { '@id': website['@id'] },
      about: { '@type': 'SoftwareSourceCode', name: appName, codeRepository: githubUrl },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: crumb.name,
        item: crumb.url,
      })),
    },
  ];
  if (page.slugs.join('/') === 'faq') graph.push(faqJsonLd(page));
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * The FAQ page as FAQPage data, built from the page itself so the two can't drift: each `##`
 * heading is a question, and the text under it is the answer.
 */
function faqJsonLd(page: NonNullable<ReturnType<typeof source.getPage>>) {
  const { headings, contents } = page.data.structuredData;
  return {
    '@type': 'FAQPage',
    mainEntity: headings.map((heading) => ({
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
  };
}
