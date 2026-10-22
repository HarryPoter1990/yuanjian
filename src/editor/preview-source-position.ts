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

/** A bounded visible-text projection, not a full Markdown source map. */
export function previewSourcePosition(
  root: HTMLElement,
  source: string,
  clicked: Node | null | undefined,
  offset: number,
): number | null {
  if (
    !clicked ||
    clicked.nodeType !== Node.TEXT_NODE ||
    !root.contains(clicked) ||
    clicked.parentElement?.closest(generatedText)
  )
    return null;
  if (
    markdown
      .parse(source, {})
      .some(
        (token) =>
          token.type === 'block_math' ||
          token.children?.some((child) => child.type === 'inline_math'),
      )
  )
    return null;
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let unsupported = false;
  const append = (from: number, to: number, decoded?: string) => {
    const value = decoded ?? source.slice(from, to);
    text += value;
    for (let index = 0; index < value.length; index++) {
      starts.push(decoded === undefined ? from + index : from);
      ends.push(decoded === undefined ? from + index + 1 : to);
    }
  };
  const visit = (node: SyntaxNode): void => {
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
  visit(markdownLanguage.parser.parse(source).topNode);
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
