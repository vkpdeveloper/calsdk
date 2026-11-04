import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/shared';

// Everything is public, AI crawlers included: being quoted by answer engines is the point.
// Only the search API is left out, since its responses aren't pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
