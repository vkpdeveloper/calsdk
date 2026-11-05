import { defineConfig } from 'tsdown';

// Unlike the other packages this one is a Node program: it reads stdin and ships a CLI.
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: 'esm',
  platform: 'node',
  dts: true,
  fixedExtension: false,
});
