import { generateOGImage } from 'fumadocs-ui/og';
import { notFound } from 'next/navigation';
import { appName } from '@/lib/shared';
import { posts } from '@/lib/source';

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/og/blog/[slug]/image.png'>) {
  const { slug } = await params;
  const entry = posts.find((p) => p.slug === slug);
  if (!entry) notFound();

  return generateOGImage({
    title: entry.post.title,
    description: entry.post.description,
    site: appName,
  });
}

export function generateStaticParams() {
  return posts.map(({ slug }) => ({ slug }));
}
