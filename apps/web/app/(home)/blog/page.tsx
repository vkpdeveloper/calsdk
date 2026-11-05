import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '@/components/breadcrumb';
import { JsonLd } from '@/components/json-ld';
import { breadcrumbs, organization, pageMetadata, website } from '@/lib/seo';
import { appName, formatDate, siteUrl } from '@/lib/shared';
import { posts } from '@/lib/source';

const description =
  'The calsdk blog has deep dives on how Google Calendar, Outlook and CalDAV really behave, and what it takes to put one API over them.';

const crumbs = [
  { name: appName, path: '/' },
  { name: 'Blog', path: '/blog' },
];

export const metadata: Metadata = pageMetadata({
  title: 'Blog: how calendar APIs really behave',
  description,
  path: '/blog',
  type: 'website',
  markdownPath: '/blog.md',
});

export default function BlogIndex() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-5 pt-16 pb-24 sm:px-8 sm:pt-24">
      <JsonLd data={blogJsonLd()} />
      <Breadcrumb crumbs={crumbs} className="mb-6 font-mono text-xs text-neutral-500" />
      <h1 className="text-[clamp(2.25rem,6vw,3.5rem)] leading-none font-semibold tracking-[-0.04em] text-white">
        Blog
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-neutral-400">{description}</p>
      <ul className="mt-12 divide-y divide-line border-y border-line">
        {posts.map(({ post, slug }) => (
          // Only the title is a link, stretched over the card, so readers that drop link-heavy
          // blocks still see the title and description as text.
          <li key={slug} className="group relative py-7">
            <time dateTime={post.date} className="font-mono text-xs text-neutral-500">
              {formatDate(post.date)}
            </time>
            <h2
              id={slug}
              className="mt-2 text-xl font-semibold tracking-tight text-neutral-100 group-hover:text-white"
            >
              <Link href={`/blog/${slug}`} className="after:absolute after:inset-0">
                {post.title}
              </Link>
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-neutral-400">{post.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function blogJsonLd() {
  const url = `${siteUrl}/blog`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      website,
      organization,
      {
        '@type': 'Blog',
        '@id': `${url}#blog`,
        // The page's H1.
        name: 'Blog',
        description,
        url,
        inLanguage: 'en',
        publisher: { '@id': organization['@id'] },
        isPartOf: { '@id': website['@id'] },
        blogPost: posts.map(({ post, slug }) => ({
          '@type': 'BlogPosting',
          '@id': `${url}/${slug}#article`,
          headline: post.title,
          url: `${url}/${slug}`,
          datePublished: post.date,
        })),
      },
      breadcrumbs(crumbs),
    ],
  };
}
