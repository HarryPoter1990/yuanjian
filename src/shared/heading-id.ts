import type MarkdownIt from 'markdown-it';
import { footnoteIds } from './footnotes';

export function headingId(text: string): string {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}
export function uniqueHeadingId(
  text: string,
  used: Set<string>,
  suffixes: Map<string, number>,
): string {
  const base = headingId(text);
  let suffix = suffixes.get(base) ?? 0;
  let id = suffix ? `${base}-${suffix}` : base;
  while (used.has(id)) id = `${base}-${++suffix}`;
  used.add(id);
  suffixes.set(base, suffix + 1);
  return id;
}

export function installHeadingIds(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'heading_ids', (state) => {
    const used = new Set(footnoteIds(state.env)),
      suffixes = new Map<string, number>();
    state.tokens.forEach((token, index) => {
      if (token.type !== 'heading_open') return;
      const title = (state.tokens[index + 1]?.children ?? [])
        .filter((child) => ['text', 'code_inline', 'image', 'inline_math'].includes(child.type))
        .map((child) => child.content)
        .join('');
      token.attrSet('id', uniqueHeadingId(title, used, suffixes));
    });
  });
}
