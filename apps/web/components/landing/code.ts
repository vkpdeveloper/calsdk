import { highlight } from 'fumadocs-core/highlight';

const FIELD = /\s*«(\w+)»$/;

/**
 * Highlights code on the server. `changed` lists 1-based lines to mark, such as the lines
 * that differ between providers. A line ending in `«name»` gets the class `field-name`, and
 * the marker is removed, so lines that mean the same thing can be lit up together.
 */
export async function highlightCode(
  code: string,
  { changed = [], lang = 'ts' }: { changed?: number[]; lang?: string } = {},
) {
  const fields: (string | undefined)[] = [];
  const lines = code
    .trim()
    .split('\n')
    .map((line) => {
      fields.push(FIELD.exec(line)?.[1]);
      return line.replace(FIELD, '');
    });
  return highlight(lines.join('\n'), {
    lang,
    theme: 'github-dark-default',
    transformers: [
      {
        line(node, line) {
          if (changed.includes(line)) this.addClassToHast(node, 'changed');
          const field = fields[line - 1];
          if (field) this.addClassToHast(node, `field-${field}`);
        },
      },
    ],
  });
}
