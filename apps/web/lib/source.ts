import { llms, loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { defineCollections, defineDocs } from 'fumadocs-mdx/macro';
import { z } from 'zod';
import { remarkTypeTableSearch } from './remark-type-table';
import { docsRoute, siteUrl } from './shared';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    mdxOptions: applyMdxPreset({ remarkPlugins: [remarkTypeTableSearch] }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

const blog = defineCollections({
  type: 'doc',
  dir: 'content/blog',
  schema: pageSchema.extend({ description: z.string(), date: z.iso.date() }),
});

/** Blog posts, newest first. A post's file name is its URL slug. */
export const posts = blog.entries
  .map((post) => ({ post, slug: post.info.path.replace(/\.mdx$/, '') }))
  .sort((a, b) => b.post.date.localeCompare(a.post.date));

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${siteUrl}${page.url})

${await page.data.getText('processed')}`,
});
