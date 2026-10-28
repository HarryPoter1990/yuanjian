import type MarkdownIt from 'markdown-it';

export function isEscaped(text: string, position: number): boolean {
  let start = position;
  while (start > 0 && text[start - 1] === '\\') start--;
  return (position - start) % 2 === 1;
}

export function installMathSyntax(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'inline_math', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    let end = state.pos + 1;
    while ((end = state.src.indexOf('$', end)) >= 0 && isEscaped(state.src, end)) end++;
    if (end < 0 || end === state.pos + 1 || /\n/.test(state.src.slice(state.pos + 1, end)))
      return false;
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
