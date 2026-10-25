import type Token from 'markdown-it/lib/token.mjs';
import { createMarkdownParser } from './renderer';

const parser = createMarkdownParser();

/** Decode only the same safe BR tokens as the renderer; keep Markdown code and escapes intact. */
export function decodeTableCellBreaks(source: string): string {
  const tokens: Token[] = [];
  parser.inline.parse(source, parser, { yuanjianTableCellBreaks: true }, tokens);
  let result = '',
    from = 0;
  for (const token of tokens) {
    const range = token.meta?.tableCellBreak as { from: number; to: number } | undefined;
    if (!range) continue;
    result += source.slice(from, range.from) + '\n';
    from = range.to;
  }
  return result + source.slice(from);
}
