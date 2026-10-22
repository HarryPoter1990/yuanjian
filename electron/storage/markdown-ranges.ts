import MarkdownIt from 'markdown-it';
import { parser } from '@lezer/markdown';

const markdown = new MarkdownIt({ html: true });
/** Keep source offsets intact while hiding regions where Markdown links are literal text. */
export function maskLiteralRegions(content: string): string {
  const characters = content.split('');
  const hide = (start: number, end: number): void => {
    for (let i = start; i < end; i++)
      if (characters[i] !== '\r' && characters[i] !== '\n') characters[i] = ' ';
  };
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') lineStarts.push(i + 1);
  for (const token of markdown.parse(content, {})) {
    if (token.map && ['fence', 'code_block', 'html_block'].includes(token.type))
      hide(lineStarts[token.map[0]], lineStarts[token.map[1]] ?? content.length);
  }
  const frontmatter = /^\ufeff?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  if (frontmatter) hide(0, frontmatter[0].length);
  // A code span closes only on a backtick run of exactly the opening length.
  const visible = characters.join('');
  for (const match of visible.matchAll(/(`+)([\s\S]*?)\1(?!`)/g))
    hide(match.index, match.index + match[0].length);
  for (const match of visible.matchAll(/<!--[\s\S]*?-->/g))
    hide(match.index, match.index + match[0].length);
  return characters.join('');
}

export interface LinkTargetRange {
  from: number;
  to: number;
  target: string;
  wiki: boolean;
  image: boolean;
}
export function linkTargetRanges(content: string): LinkTargetRange[] {
  const ranges: LinkTargetRange[] = [];
  const prose = maskLiteralRegions(content);
  parser.parse(content).iterate({
    enter(node) {
      if (node.name !== 'URL') return;
      const parent = node.node.parent?.name;
      if (!parent || !['Link', 'Image', 'LinkReference'].includes(parent)) return;
      let from = node.from;
      let to = node.to;
      if (content[from] === '<' && content[to - 1] === '>') {
        from++;
        to--;
      }
      if (content.slice(from, to) !== prose.slice(from, to)) return;
      ranges.push({
        from,
        to,
        target: content.slice(from, to),
        wiki: false,
        image: parent === 'Image',
      });
    },
  });
  for (const match of prose.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
    if (match.index > 0 && content[match.index - 1] === '\\') continue;
    const from = match.index + match[1].length + 2;
    const target = match[2].split('|')[0];
    ranges.push({ from, to: from + target.length, target, wiki: true, image: match[1] === '!' });
  }
  return ranges.sort((a, b) => a.from - b.from);
}

/** Rewrite image usages only. Shared reference definitions stay intact for ordinary links. */
export function replaceImageTargets(
  content: string,
  replacements: ReadonlyMap<string, string>,
): string {
  const lookup = (target: string): string | undefined =>
    replacements.get(target) ??
    replacements.get(markdown.normalizeLink(markdown.utils.unescapeAll(target)));
  const edits: { from: number; to: number; value: string }[] = [];
  for (const range of linkTargetRanges(content)) {
    if (!range.image) continue;
    const value = lookup(range.target);
    if (value) edits.push({ from: range.from, to: range.to, value });
  }

  const tree = parser.parse(content);
  const prose = maskLiteralRegions(content);
  const definitions = new Map<string, { target: string; title: string }>();
  tree.iterate({
    enter(node) {
      if (node.name !== 'LinkReference') return;
      const label = node.node.getChild('LinkLabel');
      const url = node.node.getChild('URL');
      if (!label || !url || content.slice(url.from, url.to) !== prose.slice(url.from, url.to))
        return;
      const key = markdown.utils.normalizeReference(content.slice(label.from + 1, label.to - 1));
      if (definitions.has(key)) return;
      definitions.set(key, {
        target: content.slice(url.from, url.to).replace(/^<|>$/g, ''),
        title: content.slice(url.to, node.to).trim(),
      });
    },
  });
  tree.iterate({
    enter(node) {
      if (node.name !== 'Image' || node.node.getChild('URL')) return;
      if (content[node.from] !== prose[node.from]) return;
      const marks = node.node.getChildren('LinkMark');
      if (marks.length < 2) return;
      const alt = content.slice(marks[0].to, marks[1].from);
      const label = node.node.getChild('LinkLabel');
      const explicitLabel = label ? content.slice(label.from + 1, label.to - 1) : '';
      const definition = definitions.get(markdown.utils.normalizeReference(explicitLabel || alt));
      if (!definition) return;
      const reference = lookup(definition.target);
      if (!reference) return;
      edits.push({
        from: node.from,
        to: node.to,
        value: `![${alt}](${reference}${definition.title ? ` ${definition.title}` : ''})`,
      });
    },
  });
  let output = content;
  let lastStart = content.length;
  for (const edit of edits.sort((left, right) => right.from - left.from)) {
    if (edit.to > lastStart) continue;
    output = output.slice(0, edit.from) + edit.value + output.slice(edit.to);
    lastStart = edit.from;
  }
  return output;
}
