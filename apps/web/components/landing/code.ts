import { highlight } from 'fumadocs-core/highlight';

/**
 * Highlights TypeScript on the server. `changed` lists 1-based lines to mark, such as the
 * lines that differ between providers.
 */
export async function highlightCode(code: string, changed: number[] = []) {
  return highlight(code.trim(), {
    lang: 'ts',
    theme: 'github-dark-default',
    transformers: [
      {
        line(node, line) {
          if (changed.includes(line)) this.addClassToHast(node, 'changed');
        },
      },
    ],
  });
}
