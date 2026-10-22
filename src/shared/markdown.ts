import MarkdownIt from 'markdown-it';
import { Document, isMap, parseDocument } from 'yaml';
import type { Heading, NoteLink, NoteMeta } from './types';

const markdown = new MarkdownIt({ html: false, linkify: false });
function readableTarget(target: string): string {
  try {
    return decodeURI(target);
  } catch {
    return target;
  }
}

function frontmatter(content: string) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match)
    return { end: 0, lines: 0, document: new Document(), tags: [] as string[], invalid: false };
  const document = parseDocument(match[1]);
  if (document.errors.length || (document.contents !== null && !isMap(document.contents)))
    return {
      end: match[0].length,
      lines: match[0].split('\n').length - 1,
      document: new Document(),
      tags: [] as string[],
      invalid: true,
    };
  let tags: string[] = [];
  try {
    const data: unknown = document.toJS({ maxAliasCount: 20 });
    if (data && typeof data === 'object' && 'tags' in data) {
      const value: unknown = data.tags;
      if (Array.isArray(value))
        tags = value.filter((item): item is string => typeof item === 'string');
      else if (typeof value === 'string') tags = value.split(/[,，\s]+/);
    }
  } catch {
    /* Malformed or excessively aliased metadata is not an instruction. */
  }
  return {
    end: match[0].length,
    lines: match[0].split('\n').length - 1,
    document,
    tags,
    invalid: false,
  };
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '');
}
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

function analyze(content: string) {
  const front = frontmatter(content);
  const tokens = markdown.parse(content.slice(front.end).replace(/^\uFEFF/, ''), {});
  const headings: Heading[] = [];
  const links: NoteLink[] = [];
  const tags = new Set(front.tags.map(normalizeTag).filter(Boolean));
  const headingCounts = new Map<string, number>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const inline = tokens[i + 1];
      const text = (inline?.children ?? [])
        .filter((child) => ['text', 'code_inline', 'image'].includes(child.type))
        .map((child) => child.content)
        .join('');
      const id = headingId(text);
      const count = headingCounts.get(id) ?? 0;
      headingCounts.set(id, count + 1);
      headings.push({
        level: Number(token.tag.slice(1)),
        text,
        line: (token.map?.[0] ?? 0) + front.lines + 1,
        id: count ? `${id}-${count}` : id,
      });
    }
    if (token.type !== 'inline') continue;
    const line = (token.map?.[0] ?? 0) + front.lines + 1;
    const children = token.children ?? [];
    for (let j = 0; j < children.length; j++) {
      const child = children[j];
      if (child.type === 'link_open') {
        const target = child.attrGet('href');
        if (target) {
          let label = '';
          for (let k = j + 1; k < children.length && children[k].type !== 'link_close'; k++)
            label += children[k].content;
          links.push({ target: readableTarget(target), label, image: false, line });
        }
      } else if (child.type === 'image') {
        const target = child.attrGet('src');
        if (target)
          links.push({ target: readableTarget(target), label: child.content, image: true, line });
      } else if (child.type === 'text') {
        for (const match of child.content.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
          const [target, ...alias] = match[2].split('|');
          links.push({
            target: target.trim(),
            label: alias.join('|') || target.trim(),
            image: match[1] === '!',
            line,
          });
        }
        for (const match of child.content.matchAll(/(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu))
          tags.add(match[1]);
      }
    }
  }
  return { headings, links, tags: [...tags] };
}

export function extractHeadings(content: string): Heading[] {
  return analyze(content).headings;
}
export function extractLinks(content: string): NoteLink[] {
  return analyze(content).links;
}
export function extractTags(content: string): string[] {
  return analyze(content).tags;
}
export function parseNote(content: string, path: string, modifiedAt = 0): NoteMeta {
  const result = analyze(content);
  const fallback =
    path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.markdown$|\.md$/i, '') || '未命名';
  return {
    path,
    title: result.headings.find((item) => item.level === 1)?.text || fallback,
    modifiedAt,
    ...result,
  };
}

export function setFrontmatterTags(content: string, values: string[]): string {
  const tags = [...new Set(values.map(normalizeTag).filter(Boolean))];
  const front = frontmatter(content);
  if (front.invalid)
    throw new Error('顶部属性存在 YAML 错误或不是键值结构，请在源码中修复后再修改标签');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const document = front.document;
  document.set('tags', tags);
  const attributes = document.toString({ lineWidth: 0 }).trimEnd().replace(/\r?\n/g, eol);
  const body = front.end ? content.slice(front.end) : content.replace(/^\uFEFF/, '');
  return `${bom}---${eol}${attributes}${eol}---${eol}${body}`;
}
