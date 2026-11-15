import type MarkdownIt from 'markdown-it';

export function isEscaped(text: string, position: number): boolean {
  let start = position;
  while (start > 0 && text[start - 1] === '\\') start--;
  return (position - start) % 2 === 1;
}

export function inlineMathEnd(source: string, start: number): number | null {
  if (source[start] !== '$' || source[start + 1] === '$' || isEscaped(source, start)) return null;
  let end = start + 1;
  while ((end = source.indexOf('$', end)) >= 0 && isEscaped(source, end)) end++;
  return end < 0 || end === start + 1 || source.slice(start + 1, end).includes('\n') ? null : end;
}

export function installMathSyntax(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'inline_math', (state, silent) => {
    const end = inlineMathEnd(state.src, state.pos);
    if (end === null) return false;
    if (!silent) {
      const token = state.push('inline_math', 'span', 0);
      token.content = state.src.slice(state.pos + 1, end);
      token.meta = {
        sourceRange: { from: state.pos, to: end + 1, contentFrom: state.pos + 1, contentTo: end },
      };
    }
    state.pos = end + 1;
    return true;
  });
  md.block.ruler.before(
    'fence',
    'block_math',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const first = state.src.slice(start, state.eMarks[startLine]);
      if (!first.startsWith('$$')) return false;
      let nextLine = startLine + 1;
      let content: string;
      if (first.length > 3 && first.endsWith('$$')) content = first.slice(2, -2);
      else {
        while (
          nextLine < endLine &&
          !/^\s*\$\$\s*$/.test(state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]))
        )
          nextLine++;
        if (nextLine === endLine) return false;
        content = [first.slice(2), state.getLines(startLine + 1, nextLine, state.blkIndent, false)]
          .filter(Boolean)
          .join('\n');
        nextLine++;
      }
      if (silent) return true;
      const token = state.push('block_math', 'div', 0);
      token.block = true;
      token.map = [startLine, nextLine];
      token.content = content;
      state.line = nextLine;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );
}
