import { notFound } from 'next/navigation';
import { markdownResponse } from '@/lib/seo';
import { siteUrl } from '@/lib/shared';
import { posts } from '@/lib/source';

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/llms.mdx/blog/[slug]'>) {
  const { slug } = await params;
  const entry = posts.find((p) => p.slug === slug);
  if (!entry) notFound();

  const { post } = entry;
  const path = `/blog/${slug}`;
  return markdownResponse(
    `# ${post.title} (${siteUrl}${path})

${post.description}

${await post.getText('processed')}`,
    path,
  );
}

export function generateStaticParams() {
  return posts.map(({ slug }) => ({ slug }));
}
