import { Facet, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { createMarkdownParser, hydrateMarkdown, renderMarkdown } from './renderer';
import { TableWidget } from './table-widget';
import type { RenderOptions } from './types';
import { activeMathRange } from './completion';
import { MathPreviewWidget } from './math-preview';

export interface PreviewConfig extends RenderOptions {
  mode: 'live' | 'source';
  resolveAsset?: (path: string) => string;
  resolveAssetAsync?: (path: string) => Promise<string>;
  onLink?: (target: string) => void;
}
export const previewConfig = Facet.define<PreviewConfig, PreviewConfig>({
  combine: (values) => values[0] ?? { mode: 'source' },
});
export interface MarkdownBlock {
  from: number;
  to: number;
  type: string;
  source: string;
}
const parser = createMarkdownParser();

export function markdownBlocks(state: EditorState): MarkdownBlock[] {
  const source = state.doc.toString();
  return parser
    .parse(source, {})
    .filter((token) => token.level === 0 && token.map && token.nesting !== -1)
    .map((token) => {
      const map = token.map;
      if (!map) throw new Error('Expected mapped token');
      const from = state.doc.line(Math.min(state.doc.lines, map[0] + 1)).from;
      const to = state.doc.line(Math.max(1, Math.min(state.doc.lines, map[1]))).to;
      return { from, to, type: token.type, source: state.doc.sliceString(from, to) };
    });
}

class PreviewWidget extends WidgetType {
  constructor(
    readonly block: MarkdownBlock,
    readonly config: PreviewConfig,
  ) {
    super();
  }
  eq(other: PreviewWidget): boolean {
    return (
      this.block.from === other.block.from &&
      this.block.to === other.block.to &&
      this.block.source === other.block.source &&
      this.config === other.config
    );
  }
  updateDOM(root: HTMLElement, _view: EditorView, previous: PreviewWidget): boolean {
    if (this.block.source !== previous.block.source || this.config !== previous.config)
      return false;
    root.dataset.sourceFrom = String(this.block.from);
    root.dataset.sourceTo = String(this.block.to);
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div');
    root.className = 'markdown-preview-block markdown-rendered';
    root.contentEditable = 'false';
    root.dataset.sourceFrom = String(this.block.from);
    root.dataset.sourceTo = String(this.block.to);
    root.innerHTML = renderMarkdown(this.block.source, this.config);
    const refresh = (): void => {
      if (root.isConnected) view.requestMeasure();
    };
    for (const image of root.querySelectorAll('img')) image.addEventListener('load', refresh);
    void hydrateMarkdown(root, this.config.resolveAssetAsync).then(refresh);
    for (const [index, checkbox] of Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).entries()) {
      checkbox.disabled = false;
      checkbox.addEventListener('change', () => {
        const matches = Array.from(
          this.block.source.matchAll(/^(?:\s*[-+*]|\s*\d+[.)])\s+\[([ xX])\]/gm),
        );
        const match = matches[index];
        if (!match || match.index === undefined) return;
        const from = Number(root.dataset.sourceFrom) + match.index + match[0].lastIndexOf('[') + 1;
        view.dispatch({
          changes: { from, to: from + 1, insert: checkbox.checked ? 'x' : ' ' },
          userEvent: 'input.task',
        });
      });
    }
    if (this.block.type === 'fence' && !/^\s*(`{3,}|~{3,})mermaid\b/.test(this.block.source)) {
      const toolbar = document.createElement('div');
      toolbar.className = 'code-language-toolbar';
      const label = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = '代码语言';
      label.append(caption);
      const input = document.createElement('input');
      input.setAttribute('aria-label', '代码语言');
      const languageLabel = root.querySelector('.code-language-label');
      input.placeholder = languageLabel?.textContent ?? '自动识别';
      input.title = '代码语言，留空自动识别；如 java、python';
      const match = this.block.source.match(/^(\s*)(`{3,}|~{3,})([^\n]*)/);
      input.value = match?.[3].trim() ?? '';
      input.addEventListener('change', () => {
        if (!match) return;
        const sourceFrom = Number(root.dataset.sourceFrom);
        const from = sourceFrom + match[1].length + match[2].length;
        const language = input.value.trim().replace(/[^\w#+.-]/g, '');
        view.dispatch({
          changes: { from, to: sourceFrom + match[0].length, insert: language },
          userEvent: 'input.language',
        });
      });
      label.append(input);
      toolbar.append(label);
      languageLabel?.replaceWith(toolbar);
      root.querySelector('details')?.addEventListener('toggle', refresh);
    }
    root.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a');
      if (link) {
        event.preventDefault();
        this.config.onLink?.(link.getAttribute('href') ?? '');
        return;
      }
      if (target?.closest('button,input,select,summary,label')) return;
      event.preventDefault();
      // Keep CodeMirror's original document and history; only expose the selected source block.
      const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
      const range = !caret ? document.caretRangeFromPoint?.(event.clientX, event.clientY) : null;
      const node = caret?.offsetNode ?? range?.startContainer;
      const textNode = node?.nodeType === Node.TEXT_NODE && root.contains(node) ? node : null;
      const text = textNode?.textContent ?? target?.textContent ?? '';
      let offset = text ? this.block.source.indexOf(text) : -1;
      if (offset < 0) offset = text ? this.block.source.indexOf(text.slice(0, 8)) : -1;
      const within = textNode ? (caret?.offset ?? range?.startOffset ?? 0) : 0;
      const position =
        Number(root.dataset.sourceFrom) +
        Math.min(this.block.source.length, Math.max(0, offset) + within);
      view.dispatch({ selection: { anchor: position }, scrollIntoView: false });
      view.focus();
    });
    return root;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(state: EditorState, blocks: MarkdownBlock[]): DecorationSet {
  const config = state.facet(previewConfig);
  const ranges: Range<Decoration>[] = [];
  if (config.mode === 'live')
    for (const block of blocks) {
      if (block.from >= block.to) continue;
      const active = state.selection.ranges.some(
        (selection) => selection.from <= block.to && selection.to >= block.from,
      );
      const isTable = block.type === 'table_open';
      if (active && !isTable) {
        if (block.type === 'fence')
          for (
            let line = state.doc.lineAt(block.from).number;
            line <= state.doc.lineAt(block.to).number;
            line++
          ) {
            ranges.push(
              Decoration.line({ class: 'cm-code-source' }).range(state.doc.line(line).from),
            );
          }
        continue;
      }
      // Block replacements include their edges so CodeMirror does not add empty text lines on both sides.
      ranges.push(
        Decoration.replace({
          block: true,
          widget: isTable
            ? new TableWidget(block.source, block.from, block.to)
            : new PreviewWidget(block, config),
        }).range(block.from, block.to),
      );
    }
  const formula = activeMathRange(state);
  if (formula)
    ranges.push(
      Decoration.widget({
        block: true,
        side: 1,
        widget: new MathPreviewWidget(formula.source),
      }).range(state.doc.lineAt(formula.to).to),
    );
  return Decoration.set(ranges, true);
}

/** Multiline replacements are supplied directly from a StateField, before viewport layout. */
export const livePreviewField = StateField.define<{
  blocks: MarkdownBlock[];
  decorations: DecorationSet;
}>({
  create(state) {
    const blocks = markdownBlocks(state);
    return { blocks, decorations: buildDecorations(state, blocks) };
  },
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection && !transaction.reconfigured)
      return value;
    const blocks = transaction.docChanged ? markdownBlocks(transaction.state) : value.blocks;
    return { blocks, decorations: buildDecorations(transaction.state, blocks) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
