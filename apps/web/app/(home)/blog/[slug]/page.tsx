import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { JsonLd } from '@/components/json-ld';
import { getMDXComponents } from '@/components/mdx';
import { postDates } from '@/lib/content-dates';
import { breadcrumbs, faqJsonLd, organization, pageMetadata, website } from '@/lib/seo';
import { appName, author, formatDate, githubUrl, siteUrl } from '@/lib/shared';
import { posts } from '@/lib/source';

function getPost(slug: string) {
  const entry = posts.find((p) => p.slug === slug);
  if (!entry) notFound();
  return entry.post;
}

type BlogPost = ReturnType<typeof getPost>;

export default async function Post(props: PageProps<'/blog/[slug]'>) {
  const { slug } = await props.params;
  const post = getPost(slug);
  const MDX = post.body;
  const dates = postDates(post);

  // The layout already provides <main>; the post is an <article> inside it.
  return (
    <article className="mx-auto w-full max-w-3xl flex-1 px-5 pt-14 pb-24 sm:px-8 sm:pt-20">
      <JsonLd data={postJsonLd(slug, post)} />
      <Breadcrumb crumbs={postCrumbs(slug, post)} className="font-mono text-xs text-neutral-500" />
      <h1 className="mt-6 text-balance text-[clamp(2rem,5.5vw,3rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-white">
        {post.title}
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-neutral-400">{post.description}</p>
      <p className="mt-6 font-mono text-xs text-neutral-500">
        <a href={author.url} className="text-neutral-300 hover:text-white">
          {author.name}
        </a>{' '}
        · Published <time dateTime={dates.published}>{formatDate(dates.published)}</time>
        {dates.modified.slice(0, 10) > dates.published.slice(0, 10) && (
          <>
            {' '}
            · Updated <time dateTime={dates.modified}>{formatDate(dates.modified)}</time>
          </>
        )}
      </p>
      {/* Long inline code, like a full property path, would push the page sideways on phones. */}
      <div className="prose mt-12 max-w-none border-t border-line pt-10 [&_:not(pre)>code]:[overflow-wrap:anywhere]">
        <MDX components={getMDXComponents()} />
      </div>
      <div className="mt-16 rounded-2xl border border-line bg-panel p-6">
        <p className="text-[15px] leading-relaxed text-neutral-300">
          calsdk is an open source TypeScript library with one API for Google Calendar, Outlook,
          iCloud, CalDAV, Zoom, Cal.com, Calendly and ICS feeds.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/docs/quickstart"
            className="flex h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200"
          >
            Try the quickstart
          </Link>
          <a
            href={githubUrl}
            className="flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium text-neutral-200 hover:border-neutral-500"
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </article>
  );
}

export function generateStaticParams() {
  return posts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata(props: PageProps<'/blog/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const post = getPost(slug);
  return pageMetadata({
    title: post.metaTitle ?? post.title,
    description: post.description,
    path: `/blog/${slug}`,
    image: `/og/blog/${slug}/image.png`,
    markdownPath: `/blog/${slug}.md`,
    dates: postDates(post),
  });
}

function postCrumbs(slug: string, post: BlogPost) {
  return [
    { name: appName, path: '/' },
    { name: 'Blog', path: '/blog' },
    { name: post.title, path: `/blog/${slug}` },
  ];
}

function postJsonLd(slug: string, post: BlogPost) {
  const url = `${siteUrl}/blog/${slug}`;
  const dates = postDates(post);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      website,
      organization,
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: post.title,
        description: post.description,
        datePublished: dates.published,
        dateModified: dates.modified,
        url,
        mainEntityOfPage: url,
        image: `${siteUrl}/og/blog/${slug}/image.png`,
        inLanguage: 'en',
        author: { '@type': 'Person', name: author.name, url: author.url },
        publisher: { '@id': organization['@id'] },
        isPartOf: { '@id': `${siteUrl}/blog#blog` },
        about: { '@type': 'SoftwareSourceCode', name: appName, codeRepository: githubUrl },
      },
      breadcrumbs(postCrumbs(slug, post)),
      ...faqJsonLd(post.structuredData),
    ],
  };
}
