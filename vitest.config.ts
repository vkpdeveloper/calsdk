import { defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript sources through the
// `@cal-sdk/source` export condition, so tests never need a prior build.
export default defineConfig({
  resolve: { conditions: ['@cal-sdk/source'] },
  ssr: { resolve: { conditions: ['@cal-sdk/source'] } },
  test: {
    include: ['packages/*/{src,test}/**/*.test.ts'],
    passWithNoTests: true,
  },
});
