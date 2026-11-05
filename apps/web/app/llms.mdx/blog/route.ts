import { markdownResponse } from '@/lib/seo';
import { siteUrl } from '@/lib/shared';
import { posts } from '@/lib/source';

export const revalidate = false;

export function GET() {
  const list = posts
    .map(({ post, slug }) => `- [${post.title}](${siteUrl}/blog/${slug}.md): ${post.description}`)
    .join('\n');
  return markdownResponse(`# calsdk blog (${siteUrl}/blog)\n\n${list}\n`, '/blog');
}
