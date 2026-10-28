import type MarkdownIt from 'markdown-it';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { uniqueHeadingId } from './heading-id';
import { footnoteIds } from './footnotes';
import { inspectFrontmatter } from './frontmatter';

export type NoteResolution = { path: string; source: string } | { error: string };
export interface NoteSyntaxOptions {
  notePath?: string;
  resolveNote?: (reference: string, from?: string) => NoteResolution;
  embedStack?: readonly string[];
  embedBudget?: { references: number; bytes: number };
  exportMode?: 'html' | 'pdf';
}

type Token = ReturnType<MarkdownIt['parse']>[number];
type BlockReference = { id: string; from: number; to: number };
export interface NoteEnvironment {
  noteComments?: { from: number; to: number }[];
  noteBlocks?: BlockReference[];
  noteUsedIds?: string[];
}
const calloutTypes: Record<string, [string, string]> = {
  note: ['笔记', '✎'],
  info: ['信息', 'ⓘ'],
  tip: ['提示', '◇'],
  warning: ['注意', '△'],
  caution: ['警示', '!'],
  danger: ['危险', '!'],
  important: ['重要', '!'],
  success: ['完成', '✓'],
  question: ['问题', '?'],
  example: ['示例', '≡'],
  quote: ['引用', '❝'],
  abstract: ['摘要', '≡'],
  failure: ['错误', '×'],
  bug: ['问题', '!'],
  todo: ['待办', '☐'],
};
const aliases: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  attention: 'warning',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};
export function calloutPresentation(type: string) {
  const key = type.toLowerCase();
  const [title, icon] = calloutTypes[aliases[key] ?? key] ?? [type, 'ⓘ'];
  return { title, icon, tone: aliases[key] ?? (calloutTypes[key] ? key : 'note') };
}

/** Source-preserving ranges: code and math remain literal; unmatched delimiters remain text. */
export function noteCommentRanges(source: string): { from: number; to: number }[] {
  const protectedRanges: { from: number; to: number }[] = [];
  markdownLanguage.parser.parse(source).iterate({
    enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) {
        protectedRanges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  for (const m of source.matchAll(
    /(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<![\\$])\$(?!\$)[^\n$]+?(?<!\\)\$(?!\$)/g,
  ))
    protectedRanges.push({ from: m.index!, to: m.index! + m[0].length });
  const ranges: { from: number; to: number }[] = [];
  for (const m of source.matchAll(/(?<!\\)%%[\s\S]*?(?<!\\)%%|<!--[\s\S]*?-->/g)) {
    const from = m.index!,
      to = from + m[0].length;
    if (!protectedRanges.some((r) => from >= r.from && from < r.to)) ranges.push({ from, to });
  }
  return ranges;
}

export function selectNoteFragment(
  md: MarkdownIt,
  source: string,
  fragment: string,
): { source: string; line: number } | { error: string } {
  if (!fragment) return { source, line: 1 };
  const environment: NoteEnvironment = {};
  const properties = inspectFrontmatter(source);
  const tokens = md.parse(
    properties
      ? source.slice(0, properties.end).replace(/[^\n]/g, ' ') + source.slice(properties.end)
      : source,
    environment,
  );
  const lines = source.split('\n');
  for (const token of tokens) {
    if (
      token.type === 'footnote_open' &&
      token.map &&
      fragment === `fn${Number(token.meta.id) + 1}`
    )
      return { source: lines.slice(token.map[0], token.map[1]).join('\n'), line: token.map[0] + 1 };
    for (const child of token.children ?? [])
      if (token.map && child.type === 'footnote_ref') {
        const id = `fnref${Number(child.meta.id) + 1}${child.meta.subId ? `:${child.meta.subId}` : ''}`;
        if (fragment === id)
          return {
            source: lines.slice(token.map[0], token.map[1]).join('\n'),
            line: token.map[0] + 1,
          };
      }
  }
  const blockId = fragment.startsWith('^')
    ? fragment.slice(1)
    : fragment.startsWith('block-') &&
        !tokens.some((token) => token.type === 'heading_open' && token.attrGet('id') === fragment)
      ? fragment.slice(6)
      : null;
  if (blockId !== null) {
    const found = (environment.noteBlocks ?? []).filter((b) => b.id === blockId);
    if (found.length !== 1)
      return { error: found.length ? `块标识重复：${fragment}` : `找不到段落：${fragment}` };
    return { source: lines.slice(found[0].from, found[0].to).join('\n'), line: found[0].from + 1 };
  }
  const headings = tokens.filter((t) => t.type === 'heading_open' && t.map);
  const found =
    headings.find((t) => t.attrGet('id') === fragment) ??
    headings.find((t) => {
      const next = tokens[tokens.indexOf(t) + 1];
      return next?.content === fragment;
    });
  if (!found?.map) return { error: `找不到标题：${fragment}` };
  const end =
    headings.find(
      (t) => t.map![0] > found.map![0] && Number(t.tag.slice(1)) <= Number(found.tag.slice(1)),
    )?.map?.[0] ?? lines.length;
  return { source: lines.slice(found.map[0], end).join('\n'), line: found.map[0] + 1 };
}

export function installNoteSyntax(
  md: MarkdownIt,
  options: NoteSyntaxOptions,
  render: (source: string, options: NoteSyntaxOptions) => string,
): void {
  const escape = md.utils.escapeHtml;
  const budget = options.embedBudget ?? { references: 0, bytes: 0 };
  md.core.ruler.before('block', 'note_comments', (state) => {
    const ranges = noteCommentRanges(state.src);
    (state.env as NoteEnvironment).noteComments = ranges;
    let last = 0,
      result = '';
    for (const range of ranges) {
      result +=
        state.src.slice(last, range.from) +
        state.src.slice(range.from, range.to).replace(/[^\n]/g, '\u2063');
      last = range.to;
    }
    state.src = result + state.src.slice(last);
  });
  // A non-space mask preserves offsets without turning a comment's tail into indented code.
  md.core.ruler.before('heading_ids', 'note_comment_masks', (state) => {
    for (const token of state.tokens)
      if (token.type === 'inline') {
        token.content = token.content.replace(/\u2063/g, '');
        for (const child of token.children ?? [])
          if (child.type === 'text') child.content = child.content.replace(/\u2063/g, '');
      }
  });
  md.core.ruler.before('inline', 'note_inline_positions', (state) => {
    const lines = state.src.split('\n'),
      starts = [0];
    for (const line of lines) starts.push(starts.at(-1)! + line.length + 1);
    for (const token of state.tokens)
      if (token.type === 'inline' && token.map) {
        const positions: number[] = [];
        token.content.split('\n').forEach((part, index) => {
          const line = token.map![0] + index,
            offset = (lines[line] ?? '').indexOf(part);
          for (let n = 0; n <= part.length; n++)
            positions.push(offset < 0 ? -1 : starts[line] + offset + n);
        });
        token.meta = { ...token.meta, notePositions: positions };
      }
  });
  md.inline.ruler.before('emphasis', 'note_spans', (state, silent) => {
    const from = state.pos;
    const marker = state.src.startsWith('==', from)
      ? '=='
      : /[~^]/.test(state.src[from] ?? '')
        ? state.src[from]
        : '';
    if (
      !marker ||
      state.src[from + marker.length] === marker[0] ||
      state.src[from - 1] === marker[0]
    )
      return false;
    let end = from + marker.length;
    while ((end = state.src.indexOf(marker, end)) >= 0 && state.src[end - 1] === '\\')
      end += marker.length;
    if (end < 0) return false;
    const content = state.src.slice(from + marker.length, end);
    if (
      !content ||
      /\n/.test(content) ||
      (marker !== '==' && /\s/.test(content.replace(/\\ /g, '')))
    )
      return false;
    if (!silent) {
      const tag = marker === '==' ? 'mark' : marker === '~' ? 'sub' : 'sup';
      const open = state.push(`note_${tag}_open`, tag, 1);
      open.meta = {
        sourceRange: {
          from,
          to: end + marker.length,
          contentFrom: from + marker.length,
          contentTo: end,
        },
      };
      const children: Token[] = [];
      md.inline.parse(content.replace(/\\ /g, ' '), md, state.env, children);
      for (const child of children)
        if (child.meta?.sourceRange) {
          for (const key of ['from', 'to', 'contentFrom', 'contentTo'])
            if (typeof child.meta.sourceRange[key] === 'number')
              child.meta.sourceRange[key] += from + marker.length;
        }
      state.tokens.push(...children);
      state.push(`note_${tag}_close`, tag, -1);
    }
    state.pos = end + marker.length;
    return true;
  });
  md.inline.ruler.before('html_inline', 'note_safe_html', (state, silent) => {
    const match = /^<(\/)?(br|u|sup|sub|mark)\b[^>]*>/i.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (match[2].toLowerCase() === 'br' && !/^<br\s*\/?>$/i.test(match[0])) return false;
    if (!silent) {
      const token = state.push('html_inline', '', 0);
      token.content = `<${match[1] ?? ''}${match[2].toLowerCase()}>`;
      token.meta = { sourceRange: { from: state.pos, to: state.pos + match[0].length } };
    }
    state.pos += match[0].length;
    return true;
  });
  md.block.ruler.before(
    'paragraph',
    'note_details',
    (state, start, end, silent) => {
      const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
      if (!/^<details(?:\s+open)?>\s*$/i.test(line)) return false;
      let close = start + 1,
        depth = 1;
      let fence: { char: string; size: number } | undefined;
      for (; close < end; close++) {
        const text = state.src.slice(
          state.bMarks[close] + state.tShift[close],
          state.eMarks[close],
        );
        const marker = /^(`{3,}|~{3,})(.*)$/.exec(text);
        if (fence) {
          if (
            marker &&
            marker[1][0] === fence.char &&
            marker[1].length >= fence.size &&
            !marker[2].trim()
          )
            fence = undefined;
          continue;
        }
        if (marker) {
          fence = { char: marker[1][0], size: marker[1].length };
          continue;
        }
        if (/^<details(?:\s+open)?>\s*$/i.test(text)) depth++;
        else if (/^<\/details>\s*$/i.test(text) && --depth === 0) break;
      }
      if (close >= end) return false;
      if (silent) return true;
      let bodyStart = start + 1;
      while (
        bodyStart < close &&
        !state.src.slice(state.bMarks[bodyStart], state.eMarks[bodyStart]).trim()
      )
        bodyStart++;
      const summary = /^\s*<summary>([^\n]*?)<\/summary>\s*$/i.exec(
        state.src.slice(state.bMarks[bodyStart], state.eMarks[bodyStart]),
      );
      const token = state.push('note_details_open', 'details', 1);
      token.map = [start, close + 1];
      token.block = true;
      token.meta = { title: summary?.[1] ?? '详细内容', open: /\sopen/i.test(line) };
      state.md.block.tokenize(state, bodyStart + (summary ? 1 : 0), close);
      state.push('note_details_close', 'details', -1);
      state.line = close + 1;
      return true;
    },
    { alt: ['paragraph', 'blockquote', 'list'] },
  );
  md.renderer.rules.note_details_open = (tokens, index) => {
    const token = tokens[index];
    return `<details class="note-details"${token.meta.open || options.exportMode === 'pdf' ? ' open' : ''}><summary>${md.renderInline(token.meta.title)}</summary>`;
  };
  md.renderer.rules.note_details_close = () => '</details>\n';
  const embed = (target: string, ordinal: number, environment: NoteEnvironment): string => {
    if (++budget.references > 128)
      return '<span class="note-reference-error" role="status">嵌入引用过多，请打开原笔记查看</span>';
    const [reference, rawFragment = ''] = target.split('#', 2);
    let fragment: string;
    try {
      fragment = decodeURIComponent(rawFragment);
    } catch {
      return `<span class="note-reference-error">嵌入位置编码无效：${escape(target)}</span>`;
    }
    const result = reference
      ? options.resolveNote?.(reference, options.notePath)
      : options.resolveNote?.(options.notePath ?? '', options.notePath);
    const error = (message: string) =>
      `<span class="note-reference-error" role="status">${escape(message)}</span>`;
    if (!result) return error(`无法解析嵌入笔记：${target}`);
    if ('error' in result) return error(result.error);
    budget.bytes += result.source.length;
    if (budget.bytes > 2 * 1024 * 1024) return error('嵌入内容超过 2 MiB，请打开原笔记查看');
    const stack = options.embedStack ?? (options.notePath ? [options.notePath] : []);
    const identity = result.path + (fragment ? `#${fragment}` : '');
    if (stack.includes(identity) || stack.length >= 12)
      return error(`循环引用或嵌入层级过深：${target}`);
    const selected = selectNoteFragment(md, result.source, fragment);
    if ('error' in selected) return error(selected.error);
    let body = render(selected.source, {
      ...options,
      notePath: result.path,
      embedStack: [...stack, identity],
      embedBudget: budget,
    });
    let prefix = `note-embed-${ordinal}-`;
    while (environment.noteUsedIds?.some((id) => id.startsWith(prefix))) prefix = 'e-' + prefix;
    body = body
      .replace(/<img(?![^>]*\bdata-asset-from=)/g, `<img data-asset-from="${escape(result.path)}"`)
      .replace(/(?<![-\w:])id="([^"]*)"/g, (_all, id: string) => `id="${prefix}${id}"`)
      .replace(/<a\b([^>]*)>/g, (_all, attributes: string) => {
        const local = /(?:^|\s)href="#([^"]*)"/.exec(attributes);
        if (local) {
          attributes = attributes.replace(/href="#([^"]*)"/, `href="#${prefix}$1"`);
          if (!/\bdata-note-link=/.test(attributes))
            attributes += ` data-note-link="${escape(result.path)}#${local[1]}"`;
        }
        if (!/\bdata-note-from=/.test(attributes))
          attributes += ` data-note-from="${escape(result.path)}"`;
        return `<a${attributes}>`;
      });
    const original = result.path + (fragment ? `#${fragment}` : '');
    return `<section class="note-embed" data-note-target="${escape(target)}"><a class="note-embed-open" href="${escape(target)}" data-note-link="${escape(original)}">打开原笔记 · ${escape(target)}</a><div class="note-embed-body">${body}</div></section>`;
  };
  const imageTarget = (target: string) =>
    /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(target);
  md.inline.ruler.before('wiki_link', 'note_embed', (state, silent) => {
    if (!state.src.startsWith('![[', state.pos)) return false;
    const end = state.src.indexOf(']]', state.pos + 3);
    if (end < 0) return false;
    const [target, dimensions = ''] = state.src.slice(state.pos + 3, end).split('|', 2);
    if (!target?.trim()) return false;
    if (!silent) {
      const token = state.push(imageTarget(target) ? 'image' : 'note_embed', '', 0);
      token.content = target;
      token.meta = { embedded: true, sourceRange: { from: state.pos, to: end + 2 } };
      if (token.type === 'image') {
        token.attrSet('src', target);
        const size = /^(\d{1,5})(?:x(\d{1,5}))?$/.exec(dimensions);
        if (size) {
          token.attrSet('width', String(Math.max(1, Math.min(10000, Number(size[1])))));
          if (size[2])
            token.attrSet('height', String(Math.max(1, Math.min(10000, Number(size[2])))));
        }
      }
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.note_embed = (tokens, index, _opts, env) =>
    embed(tokens[index].content, tokens[index].meta?.embedOrdinal ?? index, env);
  md.block.ruler.before(
    'paragraph',
    'note_embed_block',
    (state, start, _end, silent) => {
      const text = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
      const match = /^!\[\[([^\]\n]+)\]\]\s*$/.exec(text);
      if (!match || imageTarget(match[1].split('|')[0])) return false;
      if (silent) return true;
      const token = state.push('note_embed_block', '', 0);
      token.block = true;
      token.map = [start, start + 1];
      token.content = match[1].split('|')[0];
      state.line = start + 1;
      return true;
    },
    { alt: ['paragraph', 'blockquote', 'list'] },
  );
  md.renderer.rules.note_embed_block = md.renderer.rules.note_embed;
  md.core.ruler.push('note_callouts_toc_blocks', (state) => {
    const tokens = state.tokens;
    const blocks: BlockReference[] = [];
    const stack: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === 'blockquote_open') {
        const inline = tokens[i + 2];
        const match =
          inline?.type === 'inline' &&
          /^\[!([\w-]+)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n|$)/.exec(inline.content);
        if (!match) {
          stack.push(token);
          continue;
        }
        const type = match[1].toLowerCase(),
          presentation = calloutPresentation(type);
        token.type = 'note_callout_open';
        token.meta = {
          type,
          title: match[3]?.trim() || presentation.title,
          icon: presentation.icon,
          tone: presentation.tone,
          fold: match[2],
          open: match[2] !== '-',
        };
        stack.push(token);
        inline.content = inline.content.slice(match[0].length);
        if (inline.meta?.notePositions)
          inline.meta.notePositions = inline.meta.notePositions.slice(match[0].length);
        inline.children = [];
        md.inline.parse(inline.content, md, state.env, inline.children);
        if (!inline.content) {
          tokens[i + 1].hidden = true;
          tokens[i + 3].hidden = true;
        }
      } else if (token.type === 'blockquote_close') {
        const open = stack.pop();
        if (open?.type === 'note_callout_open') {
          token.type = 'note_callout_close';
          token.meta = open.meta;
        }
      }
      if (token.type !== 'inline' || !token.map) continue;
      const marker = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(token.content);
      if (marker && token.children?.at(-1)?.type === 'text') {
        blocks.push({ id: marker[1], from: token.map[0], to: token.map[1] });
        const last = token.children.at(-1)!;
        last.content = last.content.slice(0, -marker[0].length);
        tokens[i - 1].attrSet('data-note-block', marker[1]);
      }
    }
    (state.env as NoteEnvironment).noteBlocks = blocks;
    for (const token of tokens) {
      const id = token.attrGet('data-note-block');
      if (!id) continue;
      if (blocks.filter((b) => b.id === id).length === 1) token.attrSet('id', `block-${id}`);
      else token.attrSet('data-reference-error', `块标识重复：${id}`);
    }
    const used = new Set([
        ...footnoteIds(state.env),
        ...blocks.map((block) => `block-${block.id}`),
      ]),
      suffixes = new Map<string, number>();
    tokens.forEach((token, index) => {
      if (token.type !== 'heading_open') return;
      const title = (tokens[index + 1]?.children ?? [])
        .filter((child) => ['text', 'code_inline', 'image', 'inline_math'].includes(child.type))
        .map((child) => child.content)
        .join('');
      token.attrSet('id', uniqueHeadingId(title, used, suffixes));
    });
    (state.env as NoteEnvironment).noteUsedIds = [...used];
    let embedOrdinal = 0;
    for (const token of tokens)
      for (const child of [token, ...(token.children ?? [])]) {
        if (child.type === 'note_embed' || child.type === 'note_embed_block')
          child.meta = { ...child.meta, embedOrdinal: ++embedOrdinal };
        if (child.type === 'link_open') {
          const href = child.attrGet('href') ?? '';
          if (href.startsWith('#^')) {
            child.meta = { ...child.meta, originalTarget: href };
            child.attrSet('href', '#block-' + href.slice(2));
          }
        }
      }
    const headings = tokens.flatMap((t, i) =>
      t.type === 'heading_open'
        ? [
            {
              id: t.attrGet('id') ?? '',
              title: tokens[i + 1]?.children?.map((c) => c.content).join('') ?? '',
              level: Number(t.tag.slice(1)),
            },
          ]
        : [],
    );
    for (let i = 0; i < tokens.length; i++)
      if (tokens[i].type === 'inline' && /^\[toc\]$/i.test(tokens[i].content)) {
        tokens[i - 1].hidden = true;
        tokens[i + 1].hidden = true;
        tokens[i].type = 'note_toc';
        tokens[i].children = null;
        tokens[i].meta = { headings };
      }
  });
  const paragraphOpen = md.renderer.rules.paragraph_open;
  md.renderer.rules.paragraph_open = (tokens, index, opts, env, renderer) => {
    const error = tokens[index].attrGet('data-reference-error');
    return (
      (error ? `<span class="note-reference-error">${escape(error)}</span>` : '') +
      (paragraphOpen
        ? paragraphOpen(tokens, index, opts, env, renderer)
        : renderer.renderToken(tokens, index, opts))
    );
  };
  md.renderer.rules.note_toc = (tokens, index) =>
    `<nav class="note-toc" aria-label="文章目录"><strong>目录</strong><ul>${tokens[index].meta.headings.map((h: { id: string; title: string; level: number }) => `<li class="note-toc-level-${h.level}"><a href="#${escape(h.id)}">${escape(h.title)}</a></li>`).join('')}</ul></nav>`;
  md.renderer.rules.note_callout_open = (tokens, index) => {
    const m = tokens[index].meta,
      tag = m.fold ? 'details' : 'aside',
      titleTag = m.fold ? 'summary' : 'div';
    return `<${tag} class="note-callout note-callout-${escape(m.tone)}" data-callout="${escape(m.type)}"${m.fold && (m.open || options.exportMode === 'pdf') ? ' open' : ''}><${titleTag} class="note-callout-title"><span aria-hidden="true">${escape(m.icon)}</span> ${md.renderInline(m.title)}</${titleTag}><div class="note-callout-body">`;
  };
  md.renderer.rules.note_callout_close = (tokens, index) =>
    `</div></${tokens[index].meta.fold ? 'details' : 'aside'}>\n`;
}
