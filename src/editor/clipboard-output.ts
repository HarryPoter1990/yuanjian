import type { EditorView } from '@codemirror/view';
import DOMPurify from 'dompurify';
import { createMarkdownParser, renderMarkdown } from './renderer';
import { convertRichText } from './clipboard';
import { previewSourcePosition } from './preview-source-position';

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
  const root = formula.closest<HTMLElement>('.markdown-preview-block');
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

function cleanHTML(root: HTMLElement): string {
  for (const control of root.querySelectorAll(
    '.code-caption,.code-language-toolbar,.code-line-number,.table-toolbar,button,select,summary',
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
      if (
        attribute.name === 'class' ||
        attribute.name === 'id' ||
        attribute.name === 'contenteditable' ||
        (attribute.name.startsWith('data-') && attribute.name !== 'data-latex')
      )
        element.removeAttribute(attribute.name);
    }
  return DOMPurify.sanitize(root.innerHTML, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['annotation'],
    ADD_ATTR: ['encoding', 'data-latex'],
  });
}

export function markdownCopy(markdown: string): CopyContent {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(markdown, { codeLineNumbers: false });
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
        return markdownCopy(original?.display ? `$$\n${latex}\n$$` : `$${latex}$`);
      const text = range.toString();
      return text ? { markdown: text, html: `<span>${escapeText(text)}</span>` } : null;
    }
    const from = sourceOffset(view, range.startContainer, range.startOffset),
      to = sourceOffset(view, range.endContainer, range.endOffset);
    if (
      from !== null &&
      to !== null &&
      from !== to &&
      !elementOf(range.startContainer)?.closest('.markdown-preview-block') &&
      !elementOf(range.endContainer)?.closest('.markdown-preview-block')
    )
      return {
        ...markdownCopy(view.state.sliceDoc(Math.min(from, to), Math.max(from, to))),
        range: { from: Math.min(from, to), to: Math.max(from, to) },
      };
    const root = document.createElement('div');
    const fragment = range.cloneContents();
    const ancestor = elementOf(range.commonAncestorContainer);
    if (ancestor?.matches('strong,b,em,i,a,code,s,del')) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.appendChild(fragment);
      root.append(wrapper);
    } else root.append(fragment);
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
        ...markdownCopy(view.state.sliceDoc(selected.from, selected.to)),
        range: { from: selected.from, to: selected.to },
      };
}

export async function writeCopy(content: CopyContent): Promise<string[]> {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([content.markdown], { type: 'text/plain' }),
        'text/html': new Blob([content.html], { type: 'text/html' }),
      }),
    ]);
    return [];
  }
  await navigator.clipboard.writeText(content.markdown);
  return ['当前环境不支持双格式剪贴板，已复制 Markdown 文字；富文本格式未携带。'];
}
