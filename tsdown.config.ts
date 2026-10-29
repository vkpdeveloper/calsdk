import { defineConfig } from 'tsdown';

// Shared build config. Each package re-exports it from its own tsdown.config.ts.
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  dts: true,
});
