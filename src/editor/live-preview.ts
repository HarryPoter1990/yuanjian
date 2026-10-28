import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Range,
  type RangeSet,
  type Transaction,
} from '@codemirror/state';
import {
  BlockWrapper,
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { createMarkdownParser, hydrateMarkdown, renderParsedMarkdown } from './renderer';
import { TableWidget } from './table-widget';
import type { RenderOptions } from './types';
import { activeMathRange } from './completion';
import { MathPreviewWidget } from './math-preview';
import { previewSourcePosition } from './preview-source-position';
import { inspectFrontmatter } from './frontmatter';
import { prototypeTextDecorations, textBlock } from './prototype-preview';

export interface PreviewConfig extends RenderOptions {
  prototypeEditing?: boolean;
  mode: 'live' | 'source';
  resolveAsset?: (path: string) => string;
  resolveAssetAsync?: (path: string) => Promise<string>;
  onLink?: (target: string) => void;
}
export const previewConfig = Facet.define<PreviewConfig, PreviewConfig>({
  combine: (values) => values[0] ?? { mode: 'source' },
});
export const toggleNoteFold = StateEffect.define<{ from: number; collapsed: boolean }>();
export interface MarkdownBlock {
  from: number;
  to: number;
  type: string;
  source: string;
  headingLevel?: number;
  tokens: ReturnType<typeof parser.parse>;
  environment: object;
  semanticKey: string;
  error?: string;
}
const parser = createMarkdownParser();
const semanticKey = (tokens: MarkdownBlock['tokens']) =>
  JSON.stringify(
    tokens.map((item) => [
      item.type,
      item.attrs,
      item.type.startsWith('note_') ? item.meta : undefined,
      item.children?.map((child) => [child.type, child.attrs]),
    ]),
  );

export function markdownBlocks(state: EditorState): MarkdownBlock[] {
  const config = state.facet(previewConfig);
  const documentParser = config.prototypeEditing ? createMarkdownParser(config) : parser;
  const source = state.doc.toString();
  const properties = inspectFrontmatter(source);
  const environment = {};
  const parsed = documentParser.parse(
    properties
      ? source.slice(0, properties.end).replace(/[^\n]/g, ' ') + source.slice(properties.end)
      : source,
    environment,
  );
  const blocks: MarkdownBlock[] = [];
  if (properties) {
    const to = state.doc.lineAt(Math.max(0, properties.end - 1)).to;
    blocks.push({
      from: 0,
      to,
      type: 'frontmatter',
      source: source.slice(0, to),
      tokens: [],
      environment,
      semanticKey: properties.error ?? '',
      error: properties.error ?? undefined,
    });
  }
  parsed.forEach((token, index) => {
    if (token.level !== 0 || !token.map || token.nesting === -1) return;
    const map = token.map;
    if (!map) throw new Error('Expected mapped token');
    const from = state.doc.line(Math.min(state.doc.lines, map[0] + 1)).from;
    const to = state.doc.line(Math.max(1, Math.min(state.doc.lines, map[1]))).to;
    let end = index + 1;
    if (token.nesting === 1) {
      while (end < parsed.length && !(parsed[end].level === 0 && parsed[end].nesting === -1)) end++;
      end++;
    }
    let tokens = parsed.slice(index, end);
    if (token.type === 'footnote_open') {
      const open = parsed.find((item) => item.type === 'footnote_block_open');
      const close = parsed.find((item) => item.type === 'footnote_block_close');
      if (open && close) tokens = [open, ...tokens, close];
    }
    blocks.push({
      from,
      to,
      type: token.type,
      source: state.doc.sliceString(from, to),
      headingLevel: token.type === 'heading_open' ? Number(token.tag.slice(1)) : undefined,
      tokens,
      environment,
      semanticKey: semanticKey(tokens),
    });
  });
  return blocks;
}

function updatePlainParagraph(
  blocks: MarkdownBlock[],
  transaction: Transaction,
): MarkdownBlock[] | null {
  let count = 0,
    from = 0,
    to = 0,
    inserted = '';
  transaction.changes.iterChanges((a, b, _c, _d, text) => {
    count++;
    from = a;
    to = b;
    inserted = text.toString();
  });
  if (count !== 1 || /[\r\n]/.test(inserted)) return null;
  const plain = /^[\p{L}\p{N}\p{M} \t.,，。！？!?；;、（）()'"%]*$/u;
  if (!plain.test(inserted)) return null;
  const target = blocks.find(
    (block) =>
      block.type === 'paragraph_open' &&
      from >= block.from &&
      to <= block.to &&
      plain.test(block.source),
  );
  if (!target) return null;
  // Task checkboxes carry absolute source offsets. A preceding length change needs a full rebuild.
  if (
    transaction.newDoc.length !== transaction.startState.doc.length &&
    blocks.some(
      (block) =>
        block.from > target.from &&
        block.tokens.some((token) =>
          token.children?.some(
            (child) => child.type === 'html_inline' && child.content.includes('data-task-offset'),
          ),
        ),
    )
  )
    return null;
  const nextFrom = transaction.changes.mapPos(target.from, -1),
    nextTo = transaction.changes.mapPos(target.to, 1);
  const source = transaction.state.sliceDoc(nextFrom, nextTo);
  const environment = {};
  const tokens = parser.parse(source, environment);
  // Only isolated plain text can bypass the full parse. Structural/link syntax always invalidates it.
  if (
    tokens.length !== 3 ||
    tokens[0].type !== 'paragraph_open' ||
    tokens[1].children?.some((token) => token.type !== 'text')
  )
    return null;
  const lineOffset = transaction.state.doc.lineAt(nextFrom).number - 1;
  for (const token of tokens)
    if (token.map) token.map = [token.map[0] + lineOffset, token.map[1] + lineOffset];
  return blocks.map((block) =>
    block === target
      ? {
          ...block,
          from: nextFrom,
          to: nextTo,
          source,
          tokens,
          environment,
          semanticKey: semanticKey(tokens),
        }
      : {
          ...block,
          from: transaction.changes.mapPos(block.from, -1),
          to: transaction.changes.mapPos(block.to, 1),
        },
  );
}

const expandFrontmatter = StateEffect.define<boolean>();
class FrontmatterWidget extends WidgetType {
  constructor(readonly block: MarkdownBlock) {
    super();
  }
  eq(other: FrontmatterWidget): boolean {
    return this.block.source === other.block.source && this.block.error === other.block.error;
  }
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div');
    root.className = 'markdown-frontmatter';
    if (this.block.error) {
      root.classList.add('markdown-frontmatter-error');
      root.setAttribute('aria-label', 'YAML 属性错误');
      root.setAttribute('role', 'status');
      root.textContent = this.block.error;
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', '展开原始 YAML 属性');
      button.textContent = '属性 · 展开原始 YAML';
      button.addEventListener('click', () => {
        view.dispatch({
          effects: expandFrontmatter.of(true),
          selection: { anchor: Math.min(this.block.to, this.block.from + 4) },
        });
        view.focus();
      });
      root.append(button);
    }
    return root;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function sourcePosition(view: EditorView, node: Node | null, offset: number): number | null {
  if (!node || !view.contentDOM.contains(node)) return null;
  const element = node instanceof Element ? node : node.parentElement;
  const preview = element?.closest<HTMLElement>('.markdown-preview-block');
  if (preview) {
    const from = Number(preview.dataset.sourceFrom);
    const to = Number(preview.dataset.sourceTo);
    const block = view.state
      .field(livePreviewField)
      .blocks.find((candidate) => candidate.from === from && candidate.to === to);
    if (!block) return null;
    const position = previewSourcePosition(preview, block.source, node, offset);
    return position === null ? null : from + position;
  }
  if (!element?.closest('.cm-line')) return null;
  return view.posAtDOM(node, offset);
}

export function sourcePositionAtPoint(view: EditorView, event: MouseEvent): number | null {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.katex,.katex-error,.math-block')) return sourcePosition(view, target, 0);
  const document = view.contentDOM.ownerDocument;
  const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  const range = !caret ? document.caretRangeFromPoint?.(event.clientX, event.clientY) : null;
  return sourcePosition(
    view,
    caret?.offsetNode ?? range?.startContainer ?? null,
    caret?.offset ?? range?.startOffset ?? 0,
  );
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
      this.block.semanticKey === other.block.semanticKey &&
      this.config === other.config
    );
  }
  updateDOM(root: HTMLElement, _view: EditorView, previous: PreviewWidget): boolean {
    if (
      this.block.source !== previous.block.source ||
      this.block.semanticKey !== previous.block.semanticKey ||
      this.config !== previous.config
    )
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
    root.innerHTML = renderParsedMarkdown(this.block.tokens, this.config, this.block.environment);
    const refresh = (): void => {
      if (root.isConnected) view.requestMeasure();
    };
    for (const image of root.querySelectorAll('img')) image.addEventListener('load', refresh);
    void hydrateMarkdown(root, this.config.resolveAssetAsync).then(refresh);
    for (const checkbox of Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    )) {
      checkbox.dataset.taskOffset = String(Number(checkbox.dataset.taskOffset) - this.block.from);
      checkbox.disabled = false;
      checkbox.addEventListener('change', () => {
        const offset = Number(checkbox.dataset.taskOffset);
        const from = Number(root.dataset.sourceFrom) + offset;
        if (
          !Number.isInteger(offset) ||
          !/^\[[ xX]\]$/.test(view.state.doc.sliceString(from - 1, from + 2))
        )
          return;
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
    root.addEventListener('mousedown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.button !== 0 ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest('a,button,input,select,summary,label')
      )
        return;
      const anchor = sourcePositionAtPoint(view, event);
      if (anchor === null) return;
      const document = root.ownerDocument;
      const controller = new AbortController();
      const signal = controller.signal;
      const originalDoc = view.state.doc;
      document.defaultView?.addEventListener('blur', () => controller.abort(), {
        once: true,
        signal,
      });
      document.addEventListener(
        'keydown',
        (key) => {
          if (key.key === 'Escape') controller.abort();
        },
        { signal },
      );
      // A pending focus/layout correction may reset the native anchor while a widget is dragged.
      document.addEventListener(
        'mouseup',
        (release) => {
          controller.abort();
          if (
            !view.dom.isConnected ||
            view.state.doc !== originalDoc ||
            Math.hypot(release.clientX - event.clientX, release.clientY - event.clientY) <= 3
          )
            return;
          const head = sourcePositionAtPoint(view, release);
          if (head === null || head === anchor) return;
          release.preventDefault();
          view.dispatch({ selection: { anchor, head }, scrollIntoView: false });
          view.focus();
        },
        { once: true, signal },
      );
    });
    root.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button,input,select,summary,label')) return;
      const link = target?.closest('a');
      if (link && (event.detail === 0 || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.config.onLink?.(link.getAttribute('href') ?? '');
        return;
      }
      const selected = root.ownerDocument.getSelection();
      if (
        selected &&
        !selected.isCollapsed &&
        selected.anchorNode &&
        selected.focusNode &&
        view.contentDOM.contains(selected.anchorNode) &&
        view.contentDOM.contains(selected.focusNode)
      ) {
        event.preventDefault();
        const anchor = sourcePosition(view, selected.anchorNode, selected.anchorOffset);
        const head = sourcePosition(view, selected.focusNode, selected.focusOffset);
        // Keep unsupported rendered selections intact instead of moving their cursor to the block start.
        if (anchor === null || head === null || anchor === head) return;
        view.dispatch({ selection: { anchor, head }, scrollIntoView: false });
        view.focus();
        return;
      }
      event.preventDefault();
      // Keep CodeMirror's original document and history; only expose the selected source block.
      const position = sourcePositionAtPoint(view, event) ?? Number(root.dataset.sourceFrom);
      view.dispatch({ selection: { anchor: position }, scrollIntoView: false });
      view.focus();
    });
    return root;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(
  state: EditorState,
  blocks: MarkdownBlock[],
  metadataExpanded: boolean,
  folds: Map<number, boolean>,
) {
  const config = state.facet(previewConfig);
  const ranges: Range<Decoration>[] = [];
  const wrappers: Range<BlockWrapper>[] = [];
  if (config.prototypeEditing && config.mode === 'live')
    ranges.push(...prototypeTextDecorations(state, blocks, folds));
  if (config.mode === 'live')
    for (const block of blocks) {
      if (block.from >= block.to) continue;
      if (config.prototypeEditing && textBlock(block)) continue;
      if (block.type === 'frontmatter') {
        if (block.error)
          ranges.push(
            Decoration.widget({
              block: true,
              side: -1,
              widget: new FrontmatterWidget(block),
            }).range(block.from),
          );
        else if (!metadataExpanded)
          ranges.push(
            Decoration.replace({ block: true, widget: new FrontmatterWidget(block) }).range(
              block.from,
              block.to,
            ),
          );
        continue;
      }
      const active = state.selection.ranges.some(
        (selection) => selection.from <= block.to && selection.to >= block.from,
      );
      const isTable = block.type === 'table_open';
      if (active && !isTable) {
        if (block.headingLevel)
          ranges.push(
            Decoration.line({
              class: `cm-heading-source cm-heading-source-${block.headingLevel}`,
            }).range(block.from),
          );
        if (block.type === 'fence') {
          if (config.codeWrap === false)
            wrappers.push(
              BlockWrapper.create({
                tagName: 'div',
                attributes: { class: 'cm-code-source-block' },
              }).range(block.from, block.to),
            );
          for (
            let line = state.doc.lineAt(block.from).number;
            line <= state.doc.lineAt(block.to).number;
            line++
          ) {
            ranges.push(
              Decoration.line({ class: 'cm-code-source' }).range(state.doc.line(line).from),
            );
          }
        }
        continue;
      }
      // Block replacements include their edges so CodeMirror does not add empty text lines on both sides.
      ranges.push(
        Decoration.replace({
          block: true,
          widget: isTable
            ? new TableWidget(block.source, block.from, block.to, Boolean(config.prototypeEditing))
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
  return { decorations: Decoration.set(ranges, true), wrappers: BlockWrapper.set(wrappers, true) };
}

const codeScrollMeasurements = ViewPlugin.define((view) => {
  // CodeMirror watches the outer scroller. Nested code scrolling must also refresh cursor geometry.
  const scroll = (event: Event) => {
    if (event.target instanceof Element && event.target.classList.contains('cm-code-source-block'))
      view.requestMeasure();
  };
  view.contentDOM.addEventListener('scroll', scroll, true);
  return { destroy: () => view.contentDOM.removeEventListener('scroll', scroll, true) };
});

const frontmatterFocus = EditorView.domEventHandlers({
  focus(_event, view) {
    // Focus can be restored during a DOM update; reveal before the next input task.
    queueMicrotask(() => {
      if (
        !view.dom.isConnected ||
        !view.hasFocus ||
        view.state.facet(previewConfig).mode !== 'live'
      )
        return;
      const current = view.state.field(livePreviewField);
      const properties = current.blocks.find(
        (block) => block.type === 'frontmatter' && !block.error,
      );
      if (
        !current.metadataExpanded &&
        properties &&
        view.state.selection.main.from <= properties.to
      )
        view.dispatch({ effects: expandFrontmatter.of(true) });
    });
  },
});

const codeScrollMeasureKey = {};
const codeCursorScrolling = EditorView.scrollHandler.of((view, range, options) => {
  const at = view.domAtPos(range.head);
  const element = at.node instanceof Element ? at.node : at.node.parentElement;
  const block = element?.closest<HTMLElement>('.cm-code-source-block');
  if (!block) return false;
  // Scroll handlers run during CodeMirror's write phase. Read geometry in the next read phase,
  // and suppress the default outer horizontal scrolling while the cursor belongs to this block.
  view.requestMeasure({
    key: codeScrollMeasureKey,
    read: () => {
      if (!block.isConnected || range.head > view.state.doc.length) return null;
      const cursor = view.coordsAtPos(range.head, range.assoc || 1);
      if (!cursor) return null;
      return {
        cursor,
        bounds: block.getBoundingClientRect(),
        width: block.clientWidth,
        outer: view.scrollDOM.getBoundingClientRect(),
        height: view.scrollDOM.clientHeight,
      };
    },
    write: (measured) => {
      if (!measured || !block.isConnected) return;
      const { cursor, bounds, width, outer, height } = measured;
      const margin = Math.min(24, width / 4);
      if (cursor.left < bounds.left + margin)
        block.scrollLeft += cursor.left - bounds.left - margin;
      else if (cursor.right > bounds.left + width - margin)
        block.scrollLeft += cursor.right - bounds.left - width + margin;
      const yMargin = Math.min(options.yMargin, height / 4);
      const top = cursor.top - outer.top;
      const bottom = cursor.bottom - outer.top;
      if (options.y === 'center') view.scrollDOM.scrollTop += (top + bottom - height) / 2;
      else if (options.y === 'start') view.scrollDOM.scrollTop += top - yMargin;
      else if (options.y === 'end') view.scrollDOM.scrollTop += bottom - height + yMargin;
      else if (top < yMargin) view.scrollDOM.scrollTop += top - yMargin;
      else if (bottom > height - yMargin) view.scrollDOM.scrollTop += bottom - height + yMargin;
    },
  });
  return true;
});

/** Multiline replacements are supplied directly from a StateField, before viewport layout. */
export const livePreviewField = StateField.define<{
  blocks: MarkdownBlock[];
  decorations: DecorationSet;
  wrappers: RangeSet<BlockWrapper>;
  metadataExpanded: boolean;
  folds: Map<number, boolean>;
}>({
  create(state) {
    const blocks = state.facet(previewConfig).mode === 'live' ? markdownBlocks(state) : [];
    const folds = new Map<number, boolean>();
    return {
      blocks,
      folds,
      metadataExpanded: false,
      ...buildDecorations(state, blocks, false, folds),
    };
  },
  update(value, transaction) {
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      !transaction.reconfigured &&
      !transaction.effects.some(
        (effect) => effect.is(expandFrontmatter) || effect.is(toggleNoteFold),
      )
    )
      return value;
    const live = transaction.state.facet(previewConfig).mode === 'live';
    const enteringLive = live && transaction.startState.facet(previewConfig).mode !== 'live';
    const blocks = !live
      ? []
      : transaction.docChanged || enteringLive
        ? ((transaction.docChanged &&
          !enteringLive &&
          !transaction.state.facet(previewConfig).prototypeEditing
            ? updatePlainParagraph(value.blocks, transaction)
            : null) ?? markdownBlocks(transaction.state))
        : value.blocks;
    let metadataExpanded = value.metadataExpanded;
    const folds = new Map(
      [...value.folds].map(([from, collapsed]) => [transaction.changes.mapPos(from), collapsed]),
    );
    for (const effect of transaction.effects)
      if (effect.is(toggleNoteFold)) folds.set(effect.value.from, effect.value.collapsed);
    for (const effect of transaction.effects)
      if (effect.is(expandFrontmatter)) metadataExpanded = effect.value;
    const properties = blocks.find((block) => block.type === 'frontmatter');
    if (
      (transaction.selection || enteringLive) &&
      properties &&
      transaction.state.selection.main.from <= properties.to
    )
      metadataExpanded = true;
    if (!properties || transaction.state.selection.main.from > properties.to)
      metadataExpanded = false;
    return {
      blocks,
      folds,
      metadataExpanded,
      ...buildDecorations(transaction.state, blocks, metadataExpanded, folds),
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.blockWrappers.from(field, (value) => value.wrappers),
    codeScrollMeasurements,
    codeCursorScrolling,
    frontmatterFocus,
  ],
});
