import type { TypeTableProp } from '@/components/type-table';

// The few mdast and MDX JSX fields this plugin reads.
type Node = {
  type: string;
  name?: string | null;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: Node[];
  value?: string;
  data?: Record<string, unknown>;
};

/**
 * Search indexes a `<TypeTable>` as its raw props, so results showed object literals, and
 * a Markdown table as one tiny table per row, which the dialog draws as a cramped grid.
 * This gives remark-structure one readable sentence per property or row instead. The
 * search dialog renders inline code, so code spans stay in backticks.
 */
export function remarkTypeTableSearch() {
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (node.type === 'mdxJsxFlowElement' && node.name === 'TypeTable') {
        const props = readTypeProp(node);
        const contents = Object.entries(props).map(([name, prop]) => ({
          heading: undefined,
          content: `\`${name}\`: \`${prop.type}\`. ${prop.description ?? ''}`.trim(),
        }));
        node.data = { ...node.data, structuredData: { contents } };
      }
      if (node.type === 'table') {
        const [head, ...rows] = (node.children ?? []).map((row) =>
          (row.children ?? []).map(cellText),
        );
        const contents = rows.map((row) => ({
          heading: undefined,
          content: rowSentence(head ?? [], row),
        }));
        node.data = { ...node.data, structuredData: { contents } };
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/** "Label: value" for two columns; otherwise each later cell is named by its header. */
function rowSentence(header: string[], [label = '', ...cells]: string[]) {
  if (cells.length === 1) return `${label}: ${cells[0]}`;
  return [label, ...cells.map((cell, i) => `${header[i + 1]}: ${cell}`)].join('. ');
}

function cellText(node: Node): string {
  if (node.type === 'inlineCode') return `\`${node.value}\``;
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(cellText).join('').trim();
}

function readTypeProp(node: Node): Record<string, TypeTableProp> {
  const attribute = node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === 'type');
  const value = attribute?.value;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('value' in value) ||
    typeof value.value !== 'string'
  ) {
    throw new Error('<TypeTable> needs a `type={{ ... }}` object literal.');
  }
  // The expression is an object literal from our own MDX, evaluated at build time.
  const props: unknown = new Function(`return (${value.value});`)();
  if (!isPropRecord(props)) throw new Error('Every <TypeTable> property needs a string `type`.');
  return props;
}

function isPropRecord(value: unknown): value is Record<string, TypeTableProp> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (prop) => typeof prop === 'object' && prop !== null && typeof prop.type === 'string',
    )
  );
}
