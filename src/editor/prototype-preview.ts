import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { EditorState, Range } from '@codemirror/state';
import { createMarkdownParser, hydrateMarkdown, mathHtml, renderParsedMarkdown } from './renderer';
import { inCode, isEscaped } from './completion';
import { previewConfig, toggleNoteFold, type MarkdownBlock } from './live-preview';
import { calloutPresentation, noteCommentRanges, type NoteEnvironment } from './note-syntax';

export const textBlock = (block: MarkdownBlock) =>
  !/^\s*\[toc\]\s*$/i.test(block.source) &&
  [
    'paragraph_open',
    'heading_open',
    'bullet_list_open',
    'ordered_list_open',
    'blockquote_open',
    'note_callout_open',
  ].includes(block.type);

class Prefix extends WidgetType {
  constructor(
    readonly value: string,
    readonly checked: boolean | null = null,
    readonly from = 0,
  ) {
    super();
  }
  eq(other: Prefix) {
    return this.value === other.value && this.checked === other.checked && this.from === other.from;
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'prototype-list-prefix';
    if (this.checked === null) span.textContent = this.value;
    else {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = this.checked;
      input.setAttribute('aria-label', this.checked ? '标记为未完成' : '标记为完成');
      input.addEventListener('change', () =>
        view.dispatch({
          changes: { from: this.from, to: this.from + 1, insert: input.checked ? 'x' : ' ' },
          userEvent: 'input.task',
        }),
      );
      span.append(input);
    }
    return span;
  }
  ignoreEvent() {
    return this.checked !== null;
  }
}
class InlineMath extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: InlineMath) {
    return this.source === other.source && this.from === other.from && this.to === other.to;
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'prototype-inline-math';
    span.innerHTML = mathHtml(this.source, false);
    span.addEventListener('click', (event) => {
      if (!span.ownerDocument.getSelection()?.isCollapsed) return;
      event.preventDefault();
      const rect = span.getBoundingClientRect();
      const offset = Math.max(
        0,
        Math.min(
          this.source.length,
          Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * this.source.length),
        ),
      );
      view.dispatch({
        selection: { anchor: Math.min(this.to - 1, this.from + 1 + offset) },
        userEvent: 'select',
      });
      view.focus();
    });
    return span;
  }
}

class InlinePreview extends WidgetType {
  constructor(
    readonly html: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: InlinePreview) {
    return this.html === other.html && this.from === other.from && this.to === other.to;
  }
  toDOM(view: EditorView) {
    const root = document.createElement('span');
    root.className = 'prototype-inline-preview markdown-rendered';
    root.innerHTML = this.html;
    void hydrateMarkdown(root, view.state.facet(previewConfig).resolveAssetAsync).then(() => {
      if (root.isConnected) view.requestMeasure();
    });
    root.addEventListener('click', (event) => {
      if (!root.ownerDocument.getSelection()?.isCollapsed) return;
      const link = (event.target instanceof Element ? event.target : null)?.closest('a');
      event.preventDefault();
      if (link && (event.ctrlKey || event.metaKey)) {
        view.state.facet(previewConfig).onLink?.(link.getAttribute('href') ?? '');
        return;
      }
      view.dispatch({
        selection: { anchor: Math.min(this.to - 1, this.from + 1) },
        userEvent: 'select',
      });
      view.focus();
    });
    return root;
  }
}
class CalloutToggle extends WidgetType {
  constructor(
    readonly from: number,
    readonly collapsed: boolean,
  ) {
    super();
  }
  eq(other: CalloutToggle) {
    return this.from === other.from && this.collapsed === other.collapsed;
  }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prototype-callout-toggle';
    button.textContent = this.collapsed ? '▸' : '▾';
    button.setAttribute('aria-label', this.collapsed ? '展开提示块' : '折叠提示块');
    button.setAttribute('aria-expanded', String(!this.collapsed));
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        effects: toggleNoteFold.of({ from: this.from, collapsed: !this.collapsed }),
      });
    });
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

export function prototypeMathRanges(state: EditorState) {
  const source = state.doc.toString(),
    ranges: { from: number; to: number; body: string }[] = [];
  const re = /(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g;
  for (const match of source.matchAll(re)) {
    const from = match.index!,
      to = from + match[0].length;
    if (!isEscaped(source, from) && !isEscaped(source, to - 1) && !inCode(state, from))
      ranges.push({ from, to, body: match[1] });
  }
  return ranges;
}

export function prototypeTextDecorations(
  state: EditorState,
  blocks: MarkdownBlock[],
  folds = new Map<number, boolean>(),
): Range<Decoration>[] {
  const source = state.doc.toString();
  const config = state.facet(previewConfig);
  const parser = createMarkdownParser(config);
  const references =
    (blocks[0]?.environment as { references?: Record<string, { href: string }> })?.references ?? {};
  const wiki = [...source.matchAll(/\[\[([^\]\n]+)\]\]/g)].filter((m) => !inCode(state, m.index!));
  const ranges: Range<Decoration>[] = [],
    hidden: { from: number; to: number }[] = [];
  const active = (from: number, to: number) =>
    state.selection.ranges.some((r) =>
      r.empty ? r.head >= from && r.head <= to : r.from < to && r.to > from,
    );
  const supported = (from: number, to: number) =>
    blocks.some((b) => textBlock(b) && from >= b.from && to <= b.to);
  const hide = (from: number, to: number, widget?: WidgetType) => {
    if (from >= to || hidden.some((r) => from < r.to && to > r.from)) return;
    hidden.push({ from, to });
    ranges.push(Decoration.replace(widget ? { widget } : {}).range(from, to));
  };
  for (const range of noteCommentRanges(source)) {
    if (active(range.from, range.to))
      ranges.push(Decoration.mark({ class: 'prototype-comment' }).range(range.from, range.to));
    else hide(range.from, range.to);
  }
  for (const block of blocks)
    for (const token of block.tokens) {
      if (token.type !== 'note_callout_open' || !token.map) continue;
      const first = state.doc.line(token.map[0] + 1),
        last = state.doc.line(Math.min(state.doc.lines, token.map[1]));
      const bodyFrom = Math.min(source.length, first.to + 1);
      const collapsed =
        Boolean(token.meta.fold) &&
        (folds.get(first.from) ?? token.meta.fold === '-') &&
        !active(bodyFrom, last.to);
      for (let n = first.number; n <= last.number; n++)
        ranges.push(
          Decoration.line({
            class: `prototype-callout-line note-callout-${token.meta.tone}${n === first.number ? ' prototype-callout-heading' : ''}`,
          }).range(state.doc.line(n).from),
        );
      const marker = /\[![\w-]+\][+-]?(?:[ \t]+)?/.exec(first.text);
      if (marker) {
        const from = first.from + marker.index;
        if (token.meta.fold)
          ranges.push(
            Decoration.widget({ side: -1, widget: new CalloutToggle(first.from, collapsed) }).range(
              from,
            ),
          );
        if (!active(first.from, first.to))
          hide(
            from,
            first.to,
            new InlinePreview(
              `<span class="note-callout-title">${parser.utils.escapeHtml(calloutPresentation(token.meta.type).icon)} ${parser.renderInline(token.meta.title)}</span>`,
              from,
              first.to,
            ),
          );
      }
      if (collapsed && first.to < last.to) hide(first.to, last.to);
    }
  for (const block of blocks)
    for (const token of block.tokens) {
      if (!textBlock(block)) continue;
      const positions: number[] | undefined = token.meta?.notePositions;
      const htmlStack: { tag: string; from: number; contentFrom: number }[] = [];
      for (const child of token.children ?? []) {
        const relative = child.meta?.sourceRange;
        if (!relative || !positions) continue;
        const from = positions[relative.from],
          to = positions[relative.to - 1] + 1;
        if (from === undefined || from < 0 || !Number.isFinite(to) || to <= from) continue;
        const css = (
          {
            note_mark_open: 'prototype-highlight',
            note_sub_open: 'prototype-sub',
            note_sup_open: 'prototype-sup',
          } as Record<string, string>
        )[child.type];
        if (css) {
          ranges.push(Decoration.mark({ class: css }).range(from, to));
          if (!active(from, to)) {
            hide(from, positions[relative.contentFrom]);
            hide(positions[relative.contentTo], to);
          }
        } else if (
          child.type === 'html_inline' &&
          /^<\/?(?:u|sub|sup|mark|br)>$/.test(child.content)
        ) {
          if (child.content === '<br>') {
            if (!active(from, to)) hide(from, to, new InlinePreview('<br>', from, to));
          } else if (!child.content.startsWith('</'))
            htmlStack.push({ tag: child.content.slice(1, -1), from, contentFrom: to });
          else {
            const open = htmlStack.pop();
            if (open && open.tag === child.content.slice(2, -1)) {
              ranges.push(
                Decoration.mark({
                  class: `prototype-${({ mark: 'highlight', u: 'underline' } as Record<string, string>)[open.tag] ?? open.tag}`,
                }).range(open.from, to),
              );
              if (!active(open.from, to)) {
                hide(open.from, open.contentFrom);
                hide(from, to);
              }
            }
          }
        } else if (
          child.type === 'image' &&
          source.slice(from, from + 3) === '![[' &&
          !active(from, to)
        )
          hide(
            from,
            to,
            new InlinePreview(renderParsedMarkdown([child], config, block.environment), from, to),
          );
        else if (child.type === 'note_embed' && !active(from, to))
          hide(
            from,
            to,
            new InlinePreview(renderParsedMarkdown([child], config, block.environment), from, to),
          );
      }
    }
  for (const block of (blocks[0]?.environment as NoteEnvironment | undefined)?.noteBlocks ?? []) {
    const line = state.doc.line(Math.min(state.doc.lines, block.to));
    const marker = /[ \t]*\^[A-Za-z0-9-]+[ \t]*$/.exec(line.text);
    if (marker && !active(line.from, line.to)) hide(line.from + marker.index, line.to);
  }
  const tree = markdownLanguage.parser.parse(state.doc.toString());
  const linkRanges: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (!supported(node.from, node.to)) return;
      if (wiki.some((m) => node.from >= m.index! && node.to <= m.index! + m[0].length)) return;
      if (['FencedCode', 'CodeBlock'].includes(node.name)) return false;
      if (['Image', 'Link', 'Autolink', 'InlineCode'].includes(node.name))
        linkRanges.push({ from: node.from, to: node.to });
      if (node.name === 'Image') {
        if (!active(node.from, node.to)) {
          const inline = parser.parseInline(
            source.slice(node.from, node.to),
            blocks[0]?.environment ?? {},
          );
          hide(
            node.from,
            node.to,
            new InlinePreview(
              renderParsedMarkdown(inline[0].children ?? [], config),
              node.from,
              node.to,
            ),
          );
        }
        return false;
      }
      if (['Escape', 'Entity', 'HardBreak'].includes(node.name)) {
        if (!active(node.from, node.to)) {
          const raw = source.slice(node.from, node.to);
          const value =
            node.name === 'Escape'
              ? raw.slice(1)
              : node.name === 'HardBreak'
                ? ''
                : parser.utils.unescapeAll(raw);
          hide(
            node.from,
            node.to,
            value
              ? new InlinePreview(parser.utils.escapeHtml(value), node.from, node.to)
              : undefined,
          );
        }
        return;
      }
      if (node.name === 'Autolink') {
        const target = source.slice(node.from + 1, node.to - 1);
        ranges.push(
          Decoration.mark({
            class: 'prototype-link',
            attributes: {
              'data-link-target':
                target.includes('@') && !target.includes('://') ? `mailto:${target}` : target,
              title: 'Ctrl+单击打开链接',
            },
          }).range(node.from, node.to),
        );
        if (!active(node.from, node.to)) {
          hide(node.from, node.from + 1);
          hide(node.to - 1, node.to);
        }
        return false;
      }
      const names: Record<string, string> = {
        StrongEmphasis: 'prototype-strong',
        Emphasis: 'prototype-emphasis',
        InlineCode: 'prototype-inline-code',
        Link: 'prototype-link',
        Strikethrough: 'prototype-strike',
      };
      const cls = names[node.name];
      if (!cls) return;
      const children = [];
      for (let child = node.node.firstChild; child; child = child.nextSibling) children.push(child);
      const url = children.find((c) => c.name === 'URL');
      const label = children.find((c) => c.name === 'LinkLabel');
      const reference = label ? state.doc.sliceString(label.from + 1, label.to - 1) : '';
      const key = (reference || state.doc.sliceString(node.from + 1, (label?.from ?? node.to) - 1))
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
      const destination = url ? state.doc.sliceString(url.from, url.to) : references[key]?.href;
      if (node.name === 'Link' && !destination) return;
      ranges.push(
        Decoration.mark({
          class: cls,
          ...(destination
            ? {
                attributes: {
                  'data-link-target': destination,
                  title: 'Ctrl+单击打开链接',
                },
              }
            : {}),
        }).range(node.from, node.to),
      );
      if (!active(node.from, node.to)) {
        for (const child of children)
          if (
            [
              'EmphasisMark',
              'CodeMark',
              'LinkMark',
              'URL',
              'LinkTitle',
              'LinkLabel',
              'StrikethroughMark',
            ].includes(child.name)
          )
            hide(child.from, child.to);
      }
    },
  });
  for (const match of parser.linkify.match(source) ?? []) {
    const from = match.index,
      to = match.lastIndex;
    if (
      !supported(from, to) ||
      inCode(state, from) ||
      linkRanges.some((r) => from < r.to && to > r.from)
    )
      continue;
    ranges.push(
      Decoration.mark({
        class: 'prototype-link',
        attributes: { 'data-link-target': match.url, title: 'Ctrl+单击打开链接' },
      }).range(from, to),
    );
  }
  for (const match of source.matchAll(/\[\^([^\]\n]+)\]/g)) {
    const from = match.index!,
      to = from + match[0].length;
    if (!supported(from, to) || inCode(state, from) || active(from, to)) continue;
    const token = blocks
      .flatMap((b) => b.tokens.flatMap((t) => t.children ?? []))
      .find((t) => t.type === 'footnote_ref' && t.meta.label === match[1]);
    if (token)
      hide(
        from,
        to,
        new InlinePreview(renderParsedMarkdown([token], config, blocks[0]?.environment), from, to),
      );
  }
  for (const match of wiki) {
    const from = match.index!,
      to = from + match[0].length;
    if (!supported(from, to)) continue;
    const split = match[1].indexOf('|');
    const target = (split < 0 ? match[1] : match[1].slice(0, split)).trim();
    if (!target) continue;
    ranges.push(
      Decoration.mark({
        class: 'prototype-link',
        attributes: { 'data-link-target': target, title: 'Ctrl+单击打开链接' },
      }).range(from, to),
    );
    if (!active(from, to)) {
      hide(from, from + 2 + (split < 0 ? 0 : split + 1));
      hide(to - 2, to);
    }
  }
  for (const block of blocks.filter(textBlock)) {
    if (block.headingLevel && !/^ {0,3}#/.test(block.source)) {
      ranges.push(
        Decoration.line({
          class: `cm-heading-source cm-heading-source-${block.headingLevel}`,
        }).range(block.from),
      );
      if (!active(block.from, block.to)) hide(state.doc.lineAt(block.from).to, block.to);
    }
    for (let n = state.doc.lineAt(block.from).number; n <= state.doc.lineAt(block.to).number; n++) {
      const line = state.doc.line(n);
      if (inCode(state, line.from + Math.min(line.length, 1))) continue;
      const heading = /^( {0,3})(#{1,6})[ \t]+/.exec(line.text);
      const quote = /^( {0,3}>[ \t]?)+/.exec(line.text);
      const quoteLength = quote?.[0].length ?? 0;
      const list = /^( *)([-+*]|\d+[.)])[ \t]+(?:\[([ xX])\][ \t]+)?/.exec(
        line.text.slice(quoteLength),
      );
      if (heading) {
        ranges.push(
          Decoration.line({
            class: `cm-heading-source cm-heading-source-${heading[2].length}`,
          }).range(line.from),
        );
        if (!active(line.from, line.to)) hide(line.from, line.from + heading[0].length);
      } else if (quote) {
        ranges.push(Decoration.line({ class: 'prototype-quote-line' }).range(line.from));
        if (!active(line.from, line.to)) hide(line.from, line.from + quote[0].length);
      }
      if (list) {
        ranges.push(Decoration.line({ class: 'prototype-list-line' }).range(line.from));
        if (!active(line.from, line.to)) {
          const marker = /^\d/.test(list[2]) ? list[2] : '•';
          const taskFrom =
            list[3] === undefined ? 0 : line.from + quoteLength + list[0].indexOf('[') + 1;
          hide(
            line.from + quoteLength + list[1].length,
            line.from + quoteLength + list[0].length,
            new Prefix(
              marker,
              list[3] === undefined ? null : list[3].toLowerCase() === 'x',
              taskFrom,
            ),
          );
        }
      }
    }
  }
  for (const math of prototypeMathRanges(state))
    if (supported(math.from, math.to) && !active(math.from, math.to))
      hide(math.from, math.to, new InlineMath(math.body, math.from, math.to));
  return ranges;
}

export const prototypeLinks = EditorView.domEventHandlers({
  click(event, view) {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-link-target]')
        : null;
    if (!target) return false;
    // The prototype shell handles link targets locally; normal clicking remains text editing.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      view.state.facet(previewConfig).onLink?.(target.dataset.linkTarget ?? '');
      return true;
    }
    event.preventDefault();
    return false;
  },
});
