import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/lib/seo';
import { formatPostDate } from '@/lib/shared';
import { posts } from '@/lib/source';

export const metadata: Metadata = pageMetadata({
  title: 'Blog',
  description:
    'Notes from building calsdk: how Google Calendar, Outlook and CalDAV really behave, and what it takes to put one API over them.',
  path: '/blog',
});

export default function BlogIndex() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pt-16 pb-24 sm:px-8 sm:pt-24">
      <h1 className="text-[clamp(2.25rem,6vw,3.5rem)] leading-none font-semibold tracking-[-0.04em] text-white">
        Blog
      </h1>
      <ul className="mt-12 divide-y divide-line border-y border-line">
        {posts.map(({ post, slug }) => (
          <li key={slug}>
            <Link href={`/blog/${slug}`} className="group block py-7">
              <time dateTime={post.date} className="font-mono text-xs text-neutral-500">
                {formatPostDate(post.date)}
              </time>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-neutral-100 group-hover:text-white">
                {post.title}
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-neutral-400">
                {post.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
