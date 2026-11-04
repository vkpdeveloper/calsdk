import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The dev server only serves its scripts to localhost. To preview it from another machine,
  // list that host in DEV_ORIGINS, comma separated.
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(','),
};

export default withMDX(config);
