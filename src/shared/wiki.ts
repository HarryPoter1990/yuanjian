import type MarkdownIt from 'markdown-it';

/** Keep link labels and their raw source ranges identical in reading and document headings. */
export function wikiLinks(markdown: MarkdownIt): void {
  markdown.inline.ruler.before('escape', 'wiki_link', (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '[[') return false;
    const end = state.src.indexOf(']]', state.pos + 2);
    if (end < 0) return false;
    const [target, label] = state.src.slice(state.pos + 2, end).split('|');
    if (!target.trim()) return false;
    if (!silent) {
      const open = state.push('link_open', 'a', 1);
      open.attrSet('href', target.trim());
      const contentFrom = state.pos + 2 + (label === undefined ? 0 : target.length + 1);
      open.meta = {
        sourceRange: {
          from: state.pos,
          to: end + 2,
          contentFrom,
          contentTo: contentFrom + (label ?? target).length,
        },
      };
      const text = state.push('text', '', 0);
      text.content = label ?? target;
      state.push('link_close', 'a', -1);
    }
    state.pos = end + 2;
    return true;
  });
}
