import type { EditorView } from '@codemirror/view';
import DOMPurify from 'dompurify';
import { createMarkdownParser, renderMarkdown } from './renderer';
import { convertRichText } from './clipboard';
import { previewSourcePosition } from './preview-source-position';
import { inlineClipboardImages } from './clipboard-images';
import { previewConfig } from './live-preview';
import type { RenderOptions } from './types';
import {
  absoluteNoteReference,
  clipboardFileReference,
  clipboardNoteReference,
} from '../shared/note-path';

export interface CopyContent {
  markdown: string;
  html: string;
  range?: { from: number; to: number };
  sourceText?: string;
}

const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);
const formulaOf = (node: Node) => elementOf(node)?.closest<HTMLElement>('.katex,.katex-error');
const escapeText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const parser = createMarkdownParser();
function formulas(source: string): { latex: string; display: boolean }[] {
  return parser
    .parse(source, {})
    .flatMap<{ latex: string; display: boolean }>((token) =>
      token.type === 'block_math'
        ? [{ latex: token.content, display: true }]
        : (token.children ?? [])
            .filter((child) => child.type === 'inline_math')
            .map((child) => ({ latex: child.content, display: false })),
    );
}
function annotateFormula(formula: Element, latex: string, display: boolean): void {
  formula.setAttribute('data-latex', latex);
  const math = formula.querySelector('math');
  if (!math) return;
  if (display) math.setAttribute('display', 'block');
  const annotation = math.ownerDocument.createElementNS(
    'http://www.w3.org/1998/Math/MathML',
    'annotation',
  );
  annotation.setAttribute('encoding', 'application/x-tex');
  annotation.textContent = latex;
  (math.querySelector('semantics') ?? math).append(annotation);
}
function originalFormula(
  view: EditorView,
  formula: Element,
): { latex: string; display: boolean } | undefined {
  const root = formula.closest<HTMLElement>('.markdown-preview-block,.prototype-inline-math');
  if (!root) return;
  const index = [...root.querySelectorAll('.katex,.katex-error')].indexOf(formula);
  return formulas(
    view.state.sliceDoc(Number(root.dataset.sourceFrom), Number(root.dataset.sourceTo)),
  )[index];
}

function covers(range: Range, node: Node): boolean {
  const visible = node.ownerDocument!.createRange();
  visible.selectNodeContents(node);
  if (
    range.compareBoundaryPoints(Range.END_TO_START, visible) >= 0 ||
    range.compareBoundaryPoints(Range.START_TO_END, visible) <= 0
  )
    return false;
  const before = visible.cloneRange(),
    after = visible.cloneRange();
  if (range.compareBoundaryPoints(Range.START_TO_START, visible) > 0)
    before.setEnd(range.startContainer, range.startOffset);
  else before.collapse(true);
  if (range.compareBoundaryPoints(Range.END_TO_END, visible) < 0)
    after.setStart(range.endContainer, range.endOffset);
  else after.collapse(false);
  return !before.toString().trim() && !after.toString().trim();
}

const inlineFormats =
  'strong,b,em,i,a,code,s,del,mark,sub,sup,u,.prototype-strong,.prototype-emphasis,.prototype-link,.prototype-inline-code,.prototype-strike,.prototype-highlight,.prototype-sub,.prototype-sup,.prototype-underline';
function semanticWrapper(element: Element, child: Node): Node | null {
  if (element.matches('strong,b,em,i,a,code,s,del,mark,sub,sup,u')) {
    const wrapper = element.cloneNode(false);
    wrapper.appendChild(child);
    return wrapper;
  }
  const tags = [
    ['prototype-strong', 'strong'],
    ['prototype-emphasis', 'em'],
    ['prototype-link', 'a'],
    ['prototype-inline-code', 'code'],
    ['prototype-strike', 'del'],
    ['prototype-highlight', 'mark'],
    ['prototype-sub', 'sub'],
    ['prototype-sup', 'sup'],
    ['prototype-underline', 'u'],
  ].filter(([name]) => element.classList.contains(name));
  if (!tags.length) return null;
  let node = child;
  for (const [, tag] of tags.reverse()) {
    const wrapper = document.createElement(tag);
    if (tag === 'a') wrapper.setAttribute('href', element.getAttribute('data-link-target') ?? '');
    wrapper.append(node);
    node = wrapper;
  }
  return node;
}
function cleanHTML(root: HTMLElement): string {
  for (const element of root.querySelectorAll('[class*="prototype-"]')) {
    const content = document.createDocumentFragment();
    if (!element.matches(inlineFormats)) continue;
    content.append(...element.childNodes);
    const wrapper = semanticWrapper(element, content);
    if (wrapper) element.replaceWith(wrapper);
  }
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const origin = link.dataset.noteFrom,
      target = link.dataset.noteLink ?? link.getAttribute('href')!;
    if (
      origin &&
      !link.closest('[data-footnote-ref],[data-footnote-definition]') &&
      (link.dataset.noteFrom || !target.startsWith('#'))
    )
      link.setAttribute('href', clipboardNoteReference(target, origin));
  }
  for (const image of root.querySelectorAll<HTMLImageElement>('img[data-asset-src]')) {
    if (!/^data:image\/(?:png|jpeg|gif|webp|avif);/i.test(image.getAttribute('src') ?? ''))
      image.setAttribute(
        'src',
        image.dataset.assetFrom
          ? clipboardFileReference(
              absoluteNoteReference(image.dataset.assetSrc ?? '', image.dataset.assetFrom),
            )
          : (image.dataset.assetSrc ?? ''),
      );
  }
  for (const control of root.querySelectorAll(
    '.code-caption,.code-language-toolbar,.code-line-number,.table-toolbar,.note-embed-open,button,select',
  ))
    control.remove();
  for (const input of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input,textarea',
  )) {
    input.replaceWith(
      root.ownerDocument.createTextNode(
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
            ? '☑ '
            : '☐ '
          : input.value,
      ),
    );
  }
  for (const formula of root.querySelectorAll<HTMLElement>('.katex,.katex-error')) {
    if (formula.dataset.copyPartial === 'true') {
      formula.querySelector('.katex-mathml')?.remove();
      formula.replaceWith(
        root.ownerDocument.createTextNode(
          formula.querySelector('.katex-html')?.textContent ?? formula.textContent ?? '',
        ),
      );
      continue;
    }
    const math = formula.querySelector('math');
    if (math) {
      if (formula.closest('.katex-display')) math.setAttribute('display', 'block');
      formula.replaceWith(math);
    } else if (formula.dataset.latex) formula.textContent = formula.dataset.latex;
  }
  for (const hidden of root.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  for (const element of root.querySelectorAll('*'))
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'class') {
        const semantic = attribute.value
          .split(/\s+/)
          .filter((value) => /^footnote(?:s|s-list|s-sep|-ref|-item|-backref)$/.test(value))
          .join(' ');
        if (semantic) {
          element.setAttribute('class', semantic);
          continue;
        }
      }
      if (
        attribute.name === 'id' &&
        /^fn(?:ref)?\d+(?::\d+)?$/.test(attribute.value) &&
        (element.hasAttribute('data-footnote-definition') ||
          element.parentElement?.hasAttribute('data-footnote-ref'))
      )
        continue;
      if (
        attribute.name === 'class' ||
        attribute.name === 'id' ||
        attribute.name === 'contenteditable' ||
        (attribute.name.startsWith('data-') &&
          !['data-latex', 'data-footnote-ref', 'data-footnote-definition'].includes(attribute.name))
      )
        element.removeAttribute(attribute.name);
    }
  return DOMPurify.sanitize(root.innerHTML, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['annotation'],
    ADD_ATTR: ['encoding', 'data-latex'],
  });
}

export function markdownCopy(markdown: string, options: RenderOptions = {}): CopyContent {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(markdown, { ...options, codeLineNumbers: false });
  const maths = formulas(markdown);
  [...root.querySelectorAll('.katex,.katex-error')].forEach((formula, index) => {
    if (maths[index]) annotateFormula(formula, maths[index].latex, maths[index].display);
  });
  return { markdown, html: cleanHTML(root) };
}

function sourceOffset(view: EditorView, node: Node, offset: number): number | null {
  if (formulaOf(node)) return null;
  const preview = elementOf(node)?.closest<HTMLElement>('.markdown-preview-block');
  if (preview) {
    const from = Number(preview.dataset.sourceFrom),
      to = Number(preview.dataset.sourceTo);
    const position = previewSourcePosition(
      preview,
      view.state.doc.sliceString(from, to),
      node,
      offset,
    );
    return position === null ? null : from + position;
  }
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return null;
  }
}

export function selectedCopy(view: EditorView): CopyContent | null {
  const copy = (source: string) => markdownCopy(source, view.state.facet(previewConfig));
  const selection = view.dom.ownerDocument.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    selection.rangeCount &&
    selection.anchorNode &&
    selection.focusNode &&
    view.contentDOM.contains(selection.anchorNode) &&
    view.contentDOM.contains(selection.focusNode)
  ) {
    const range = selection.getRangeAt(0);
    const formula = formulaOf(range.startContainer);
    if (formula && formula === formulaOf(range.endContainer)) {
      const visible = formula.querySelector('.katex-html') ?? formula;
      const original = originalFormula(view, formula);
      const latex = original?.latex;
      if (latex && covers(range, visible))
        return copy(original?.display ? `$$\n${latex}\n$$` : `$${latex}$`);
      const text = range.toString();
      return text ? { markdown: text, html: `<span>${escapeText(text)}</span>` } : null;
    }
    const from = sourceOffset(view, range.startContainer, range.startOffset),
      to = sourceOffset(view, range.endContainer, range.endOffset);
    const sourceVisible =
      elementOf(range.startContainer)?.closest('[data-source-visible="true"]') ||
      elementOf(range.endContainer)?.closest('[data-source-visible="true"]');
    if (sourceVisible && from !== null && to !== null && from !== to) {
      const start = Math.min(from, to),
        end = Math.max(from, to),
        source = view.state.sliceDoc(start, end);
      const current = view.state.selection.main;
      // Selected source already contains its markers; converting its styled DOM wraps it twice.
      if (source === range.toString() || (current.from === start && current.to === end))
        return { ...copy(source), range: { from: start, to: end } };
    }
    if (
      from !== null &&
      to !== null &&
      from !== to &&
      !elementOf(range.startContainer)?.closest('.markdown-preview-block') &&
      !elementOf(range.endContainer)?.closest('.markdown-preview-block') &&
      !elementOf(range.startContainer)?.closest(inlineFormats) &&
      !elementOf(range.endContainer)?.closest(inlineFormats)
    )
      return {
        ...copy(view.state.sliceDoc(Math.min(from, to), Math.max(from, to))),
        range: { from: Math.min(from, to), to: Math.max(from, to) },
      };
    const root = document.createElement('div');
    const fragment = range.cloneContents();
    let copied: Node = fragment;
    for (
      let ancestor = elementOf(range.commonAncestorContainer);
      ancestor && ancestor !== view.contentDOM;
      ancestor = ancestor.parentElement
    ) {
      copied = semanticWrapper(ancestor, copied) ?? copied;
      if (ancestor.classList.contains('markdown-preview-block')) break;
    }
    root.append(copied);
    const references = [...root.querySelectorAll<HTMLElement>('[data-footnote-ref]')];
    if (references.length) {
      const definitions = new Set(
        [...root.querySelectorAll<HTMLElement>('[data-footnote-definition]')].map(
          (node) => node.dataset.footnoteDefinition,
        ),
      );
      const full = document.createElement('div');
      full.innerHTML = renderMarkdown(view.state.doc.toString());
      for (const reference of references) {
        const label = reference.dataset.footnoteRef;
        if (definitions.has(label)) continue;
        const definition = [
          ...full.querySelectorAll<HTMLElement>('[data-footnote-definition]'),
        ].find((node) => node.dataset.footnoteDefinition === label);
        if (definition) {
          root.append(definition.cloneNode(true));
          definitions.add(label);
        }
      }
    }
    const originals = [...view.contentDOM.querySelectorAll('.katex,.katex-error')].filter((node) =>
      range.intersectsNode(node),
    );
    [...root.querySelectorAll<HTMLElement>('.katex,.katex-error')].forEach((formula, index) => {
      if (
        originals[index] &&
        !covers(range, originals[index].querySelector('.katex-html') ?? originals[index])
      )
        formula.dataset.copyPartial = 'true';
      else if (originals[index]) {
        const original = originalFormula(view, originals[index]);
        if (original) annotateFormula(formula, original.latex, original.display);
      }
    });
    const html = cleanHTML(root),
      result = convertRichText(html, selection.toString());
    return result.markdown
      ? {
          markdown: result.markdown,
          html,
          ...(from !== null && to !== null && from !== to
            ? {
                range: { from: Math.min(from, to), to: Math.max(from, to) },
                sourceText: view.state.sliceDoc(Math.min(from, to), Math.max(from, to)),
              }
            : {}),
        }
      : null;
  }
  const selected = view.state.selection.main;
  return selected.empty
    ? null
    : {
        ...copy(view.state.sliceDoc(selected.from, selected.to)),
        range: { from: selected.from, to: selected.to },
      };
}

export async function writeCopy(
  content: CopyContent,
  resolveAsset?: (reference: string) => Promise<string>,
): Promise<string[]> {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    const prepared = inlineClipboardImages(content.html, resolveAsset);
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([content.markdown], { type: 'text/plain' }),
        'text/html': prepared.then((result) => new Blob([result.html], { type: 'text/html' })),
      }),
    ]);
    return (await prepared).notices;
  }
  await navigator.clipboard.writeText(content.markdown);
  return ['当前环境不支持双格式剪贴板，已复制 Markdown 文字；富文本格式未携带。'];
}
