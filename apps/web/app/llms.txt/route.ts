import { appDescription, appName, siteUrl } from '@/lib/shared';
import { docsLlms, posts, source } from '@/lib/source';

export const revalidate = false;

// https://llmstxt.org: a title, a one-line summary, then every docs page and blog post under `##`
// sections.
// Links point at each page's Markdown, which tools can read without rendering HTML.
export async function GET() {
  const sections = source.getPageTree().children.map((node) => docsLlms.indexNode(node));
  const index = sections
    .join('\n')
    // Fumadocs writes sidebar separators as bold list items; the format wants headings.
    .replace(/^- \*\*(.+)\*\*$/gm, '## $1')
    .replace(/\]\((\/docs[^)]*)\)/g, (_, path: string) => `](${siteUrl}${path}.md)`);
  const blog = posts
    .map(({ post, slug }) => `- [${post.title}](${siteUrl}/blog/${slug}.md): ${post.description}`)
    .join('\n');

  return new Response(`# ${appName}

> ${appDescription}

calsdk is a library, not a hosted service: it runs in your app and calls each provider's API with tokens your app passes in. Install the core package and one package per calendar, for example \`npm install @cal-sdk/core @cal-sdk/google\`. Every page below is also served as Markdown at its URL plus \`.md\`, and all of them together at ${siteUrl}/llms-full.txt.
${index}

## Blog

- [calsdk blog](${siteUrl}/blog.md): Every post, newest first.
${blog}
`);
}
