import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// Every docs page is also served as Markdown, for AI tools and anything else that reads text:
// at its URL plus `.md`, or at its URL when the request prefers Markdown.
const markdown = '/llms.mdx/docs/:path*/content.md';
const prefersMarkdown = [{ type: 'header', key: 'accept', value: '(.*)text/markdown(.*)' }];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The dev server only serves its scripts to localhost. To preview it from another machine,
  // list that host in DEV_ORIGINS, comma separated.
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(','),
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/docs.md', destination: '/llms.mdx/docs/content.md' },
        { source: '/docs/:path*.md', destination: markdown },
        { source: '/docs', has: prefersMarkdown, destination: '/llms.mdx/docs/content.md' },
        { source: '/docs/:path*', has: prefersMarkdown, destination: markdown },
      ],
    };
  },
};

export default withMDX(config);
