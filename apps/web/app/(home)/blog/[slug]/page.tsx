import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/json-ld';
import { getMDXComponents } from '@/components/mdx';
import { pageMetadata, website } from '@/lib/seo';
import { appName, author, formatPostDate, githubUrl, siteUrl } from '@/lib/shared';
import { posts } from '@/lib/source';

function getPost(slug: string) {
  const entry = posts.find((p) => p.slug === slug);
  if (!entry) notFound();
  return entry.post;
}

export default async function Post(props: PageProps<'/blog/[slug]'>) {
  const { slug } = await props.params;
  const post = getPost(slug);
  const MDX = post.body;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pt-14 pb-24 sm:px-8 sm:pt-20">
      <JsonLd data={postJsonLd(slug, post)} />
      <Link href="/blog" className="font-mono text-xs text-neutral-500 hover:text-neutral-300">
        ← Blog
      </Link>
      <h1 className="mt-6 text-balance text-[clamp(2rem,5.5vw,3rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-white">
        {post.title}
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-neutral-400">{post.description}</p>
      <p className="mt-6 font-mono text-xs text-neutral-500">
        <a href={author.url} className="text-neutral-300 hover:text-white">
          {author.name}
        </a>{' '}
        · <time dateTime={post.date}>{formatPostDate(post.date)}</time>
      </p>
      {/* Long inline code, like a full property path, would push the page sideways on phones. */}
      <article className="prose mt-12 max-w-none border-t border-line pt-10 [&_:not(pre)>code]:[overflow-wrap:anywhere]">
        <MDX components={getMDXComponents()} />
      </article>
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
    </main>
  );
}

export function generateStaticParams() {
  return posts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata(props: PageProps<'/blog/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const post = getPost(slug);
  return pageMetadata({
    title: post.title,
    description: post.description,
    path: `/blog/${slug}`,
    image: `/og/blog/${slug}/image.png`,
  });
}

function postJsonLd(slug: string, post: ReturnType<typeof getPost>) {
  const url = `${siteUrl}/blog/${slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      website,
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        url,
        image: `${siteUrl}/og/blog/${slug}/image.png`,
        inLanguage: 'en',
        author: { '@type': 'Person', name: author.name, url: author.url },
        isPartOf: { '@id': website['@id'] },
        about: { '@type': 'SoftwareSourceCode', name: appName, codeRepository: githubUrl },
      },
      ...faqJsonLd(post),
    ],
  };
}

/**
 * A post's `## FAQ` section as FAQPage data, built from the post itself so the two can't drift:
 * every heading after `## FAQ` is a question, and the text under it is the answer.
 */
function faqJsonLd(post: ReturnType<typeof getPost>) {
  const { headings, contents } = post.structuredData;
  const start = headings.findIndex((heading) => heading.content === 'FAQ');
  if (start === -1) return [];

  return [
    {
      '@type': 'FAQPage',
      mainEntity: headings.slice(start + 1).map((heading) => ({
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
