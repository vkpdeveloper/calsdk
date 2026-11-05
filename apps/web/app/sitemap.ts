import type { MetadataRoute } from 'next';
import { contentDates, postDates } from '@/lib/content-dates';
import { siteUrl } from '@/lib/shared';
import { posts, source } from '@/lib/source';

// `lastModified` is the page's last commit, the same date the page shows and its JSON-LD carries.
export default function sitemap(): MetadataRoute.Sitemap {
  const blogPosts = posts.map(({ post, slug }) => ({
    url: `${siteUrl}/blog/${slug}`,
    lastModified: postDates(post).modified,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  return [
    { url: siteUrl, changeFrequency: 'weekly', priority: 1 },
    ...source.getPages().map((page) => ({
      url: `${siteUrl}${page.url}`,
      lastModified: contentDates(`content/docs/${page.path}`)?.modified,
      changeFrequency: 'weekly' as const,
      priority: page.slugs.length === 0 ? 0.9 : 0.7,
    })),
    {
      url: `${siteUrl}/blog`,
      lastModified: blogPosts[0]?.lastModified,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    ...blogPosts,
  ];
}
