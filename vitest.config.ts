import { defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript sources through the
// `@calsdk/source` export condition, so tests never need a prior build.
export default defineConfig({
  resolve: { conditions: ['@calsdk/source'] },
  ssr: { resolve: { conditions: ['@calsdk/source'] } },
  test: {
    include: ['packages/*/{src,test}/**/*.test.ts'],
    passWithNoTests: true,
  },
});
