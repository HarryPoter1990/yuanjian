import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { EditorState, Range } from '@codemirror/state';
import { mathHtml } from './renderer';
import { inCode, isEscaped } from './completion';
import { previewConfig, type MarkdownBlock } from './live-preview';

export const textBlock = (block: MarkdownBlock) =>
  [
    'paragraph_open',
    'heading_open',
    'bullet_list_open',
    'ordered_list_open',
    'blockquote_open',
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
): Range<Decoration>[] {
  const source = state.doc.toString();
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
  const tree = markdownLanguage.parser.parse(state.doc.toString());
  tree.iterate({
    enter(node) {
      if (!supported(node.from, node.to)) return;
      if (wiki.some((m) => node.from >= m.index! && node.to <= m.index! + m[0].length)) return;
      if (['FencedCode', 'CodeBlock'].includes(node.name)) return false;
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
    for (let n = state.doc.lineAt(block.from).number; n <= state.doc.lineAt(block.to).number; n++) {
      const line = state.doc.line(n);
      if (inCode(state, line.from + Math.min(line.length, 1))) continue;
      const heading = /^( {0,3})(#{1,6})[ \t]+/.exec(line.text);
      const quote = /^( {0,3}>[ \t]?)+/.exec(line.text);
      const list = /^( *)([-+*]|\d+[.)])[ \t]+(?:\[([ xX])\][ \t]+)?/.exec(line.text);
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
      } else if (list) {
        ranges.push(Decoration.line({ class: 'prototype-list-line' }).range(line.from));
        if (!active(line.from, line.to)) {
          const marker = /^\d/.test(list[2]) ? list[2] : '•';
          const taskFrom = list[3] === undefined ? 0 : line.from + list[0].indexOf('[') + 1;
          hide(
            line.from + list[1].length,
            line.from + list[0].length,
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
