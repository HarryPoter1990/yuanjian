import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { inspectFrontmatter } from './frontmatter';
export interface FootnoteEnvironment {
  footnotes?: { list?: { label?: string; count?: number }[] };
  noteDefinitions?: Record<string, [number, number]>;
}
export function footnoteIds(environment: FootnoteEnvironment): string[] {
  return (environment.footnotes?.list ?? []).flatMap((note, index) => [
    `fn${index + 1}`,
    ...Array.from(
      { length: note.count ?? 1 },
      (_, sub) => `fnref${index + 1}${sub ? `:${sub}` : ''}`,
    ),
  ]);
}
export function installFootnotes(md: MarkdownIt): void {
  md.use(footnote);
  md.inline.ruler.disable('footnote_inline');
  md.core.ruler.before('footnote_tail', 'note_definition_ranges', (state) => {
    const environment = state.env as FootnoteEnvironment;
    const definitions = (environment.noteDefinitions = Object.create(null) as Record<
      string,
      [number, number]
    >);
    let label: string | undefined;
    for (const token of state.tokens) {
      if (token.type === 'footnote_reference_open') label = String(token.meta.label);
      else if (token.type === 'footnote_reference_close') label = undefined;
      else if (label !== undefined && token.map) {
        const previous = definitions[label];
        definitions[label] = previous
          ? [Math.min(previous[0], token.map[0]), Math.max(previous[1], token.map[1])]
          : [...token.map];
      }
    }
  });
  md.core.ruler.after('footnote_tail', 'note_definition_maps', (state) => {
    const definitions = (state.env as FootnoteEnvironment).noteDefinitions;
    for (const token of state.tokens)
      if (token.type === 'footnote_open' && token.meta.label !== undefined)
        token.map = definitions?.[String(token.meta.label)] ?? null;
  });
  const open = md.renderer.rules.footnote_open!;
  const reference = md.renderer.rules.footnote_ref!;
  md.renderer.rules.footnote_ref = (tokens, index, options, env, renderer) =>
    reference(tokens, index, options, env, renderer).replace(
      '<sup ',
      `<sup data-footnote-ref="${md.utils.escapeHtml(String(tokens[index].meta.label))}" `,
    );
  md.renderer.rules.footnote_open = (tokens, index, options, env, renderer) =>
    open(tokens, index, options, env, renderer).replace(
      '<li ',
      `<li data-footnote-definition="${md.utils.escapeHtml(String(tokens[index].meta.label))}" value="${Number(tokens[index].meta.id) + 1}" `,
    );
}
const parser = new MarkdownIt().use(installFootnotes);
export function footnoteLine(source: string, fragment: string): number | undefined {
  const properties = inspectFrontmatter(source);
  const tokens = parser.parse(
    properties
      ? source.slice(0, properties.end).replace(/[^\n]/g, ' ') + source.slice(properties.end)
      : source,
    {},
  );
  for (const token of tokens) {
    if (
      token.type === 'footnote_open' &&
      fragment === `fn${Number(token.meta.id) + 1}` &&
      token.map
    )
      return token.map[0] + 1;
    if (token.map)
      for (const child of token.children ?? []) {
        if (child.type !== 'footnote_ref') continue;
        const id = `fnref${Number(child.meta.id) + 1}${child.meta.subId ? `:${child.meta.subId}` : ''}`;
        if (fragment === id) return token.map[0] + 1;
      }
  }
}
