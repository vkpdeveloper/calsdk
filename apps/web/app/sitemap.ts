import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/shared';
import { posts, source } from '@/lib/source';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl, changeFrequency: 'weekly', priority: 1 },
    ...source.getPages().map((page) => ({
      url: `${siteUrl}${page.url}`,
      changeFrequency: 'weekly' as const,
      priority: page.slugs.length === 0 ? 0.9 : 0.7,
    })),
    { url: `${siteUrl}/blog`, changeFrequency: 'weekly', priority: 0.7 },
    ...posts.map(({ post, slug }) => ({
      url: `${siteUrl}/blog/${slug}`,
      lastModified: post.date,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
