import { markdownLanguage } from '@codemirror/lang-markdown';
import type { SyntaxNode } from '@lezer/common';
import { createMarkdownParser } from './renderer';

const markdown = createMarkdownParser();
const hiddenSource = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'TaskMarker',
  'LinkMark',
  'LinkLabel',
  'LinkTitle',
  'CodeMark',
  'CodeInfo',
  'Image',
  'LinkReference',
  'HorizontalRule',
  'HardBreak',
]);
const generatedText = [
  'button',
  'input',
  'select',
  'summary',
  'label',
  'svg',
  'math',
  '.code-caption',
  '.code-language-toolbar',
  '.code-line-number',
  '.katex',
  '.math-block',
  '.mermaid-diagram',
  '[aria-hidden="true"]',
].join(',');

interface SourceAtom {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  kind: 'math' | 'wiki';
}

function sourceAtoms(
  source: string,
  tree: ReturnType<typeof markdownLanguage.parser.parse>,
): SourceAtom[] {
  const starts = [0];
  for (const line of source.split('\n')) starts.push(starts[starts.length - 1] + line.length + 1);
  const blocks: SourceAtom[] = markdown
    .parse(source, {})
    .filter((token) => token.type === 'block_math' && token.map)
    .map((token) => {
      const line = starts[token.map![0]];
      const from = source.indexOf('$$', line);
      return {
        from,
        to: Math.min(source.length, starts[token.map![1]] ?? source.length),
        contentFrom: from + 2,
        contentTo: Math.min(source.length, starts[token.map![1]] ?? source.length) - 2,
        kind: 'math',
      };
    });
  const inline: SourceAtom[] = [];
  for (const token of markdown.parseInline(source, {})[0]?.children ?? []) {
    const range = token.meta?.sourceRange;
    if (!range || (token.type !== 'inline_math' && token.type !== 'link_open')) continue;
    let code = false;
    for (
      let node: SyntaxNode | null = tree.resolveInner(range.from + 1, 1);
      node;
      node = node.parent
    )
      if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) code = true;
    if (!code && !blocks.some((block) => range.from < block.to && range.to > block.from))
      inline.push({ ...range, kind: token.type === 'inline_math' ? 'math' : 'wiki' });
  }
  return [...blocks, ...inline].sort((a, b) => a.from - b.from);
}

/** A bounded visible-text projection, not a full Markdown source map. */
export function previewSourcePosition(
  root: HTMLElement,
  source: string,
  clicked: Node | null | undefined,
  offset: number,
): number | null {
  if (!clicked || !root.contains(clicked)) return null;
  const element = clicked instanceof Element ? clicked : clicked.parentElement;
  const formula =
    element?.closest('.katex,.katex-error') ??
    element?.closest('.math-block')?.querySelector('.katex,.katex-error');
  if (!formula && (clicked.nodeType !== Node.TEXT_NODE || element?.closest(generatedText)))
    return null;
  const tree = markdownLanguage.parser.parse(source);
  const atoms = sourceAtoms(source, tree);
  if (formula) {
    const index = [...root.querySelectorAll('.katex,.katex-error')].indexOf(formula);
    return atoms.filter((atom) => atom.kind === 'math')[index]?.contentFrom ?? null;
  }
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let unsupported = false;
  let atomIndex = 0;
  const append = (from: number, to: number, decoded?: string) => {
    if (decoded === undefined) {
      for (let index = from; index < to; index++) {
        while (atoms[atomIndex] && atoms[atomIndex].to <= index) atomIndex++;
        const atom = atoms[atomIndex]?.from <= index ? atoms[atomIndex] : undefined;
        if (atom && (atom.kind === 'math' || index < atom.contentFrom || index >= atom.contentTo))
          continue;
        text += source[index];
        starts.push(index);
        ends.push(index + 1);
      }
      return;
    }
    if (atoms.some((atom) => from < atom.to && to > atom.from)) {
      append(from, to);
      return;
    }
    const value = decoded ?? source.slice(from, to);
    text += value;
    for (let index = 0; index < value.length; index++) {
      starts.push(decoded === undefined ? from + index : from);
      ends.push(decoded === undefined ? from + index + 1 : to);
    }
  };
  const visit = (node: SyntaxNode): void => {
    if (
      atoms.some((atom) => atom.kind === 'wiki' && node.from >= atom.from && node.to <= atom.to)
    ) {
      append(node.from, node.to);
      return;
    }
    if (hiddenSource.has(node.name) || (node.name === 'URL' && node.parent?.name !== 'Autolink'))
      return;
    if (
      node.name.startsWith('HTML') ||
      (node.name === 'Link' && source[node.from - 1] === '[' && source[node.to] === ']')
    ) {
      unsupported = true;
      return;
    }
    if (node.name === 'Entity' || node.name === 'Escape') {
      append(node.from, node.to, markdown.utils.unescapeAll(source.slice(node.from, node.to)));
      return;
    }
    if (node.name === 'CodeText' || node.name === 'URL') {
      append(node.from, node.to);
      return;
    }
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      for (let child = node.firstChild; child; child = child.nextSibling)
        if (child.name === 'CodeText') visit(child);
      return;
    }
    if (node.name === 'InlineCode') {
      const first = node.firstChild;
      const last = node.lastChild;
      if (!first || !last) {
        unsupported = true;
        return;
      }
      let from = first.to,
        to = last.from;
      const content = source.slice(from, to).replace(/\n/g, ' ');
      if (content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) {
        from++;
        to--;
      }
      for (let index = from; index < to; index++) {
        if (source[index] === '\n') append(index, index + 1, ' ');
        else append(index, index + 1);
      }
      return;
    }
    let cursor = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      append(cursor, child.from);
      visit(child);
      cursor = child.to;
    }
    append(cursor, node.to);
  };
  visit(tree.topNode);
  if (unsupported) return null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(generatedText) || !node.textContent?.trim()) continue;
    const value = node.textContent;
    const match = text.indexOf(value, cursor);
    if (match < 0) return null;
    if (node === clicked) {
      const within = Math.max(0, Math.min(value.length, offset));
      return within ? ends[match + within - 1] : starts[match];
    }
    cursor = match + value.length;
  }
  return null;
}
