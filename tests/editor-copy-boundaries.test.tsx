// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import { selectedCopy } from '../src/editor/clipboard-output';
import type { MarkdownEditorHandle, MarkdownEditorProps } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import { renderMarkdown } from '../src/editor/renderer';
let host: HTMLDivElement, root: Root;
const reference = createRef<MarkdownEditorHandle>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  document.getSelection()?.removeAllRanges();
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(
  value = '# 顶\n\n**加粗文字**\n\n$x+1$\n\n尾段',
  extra: Partial<MarkdownEditorProps> = {},
) {
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={reference}
        value={value}
        initialCursor={value.length}
        mode="live"
        settings={defaultSettings}
        onChange={() => {}}
        {...extra}
      />,
    ),
  );
  return reference.current!.getView()!;
}
function textSelection(element: Element, partial = false) {
  const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walk.nextNode())) if (node.textContent) nodes.push(node as Text);
  const range = document.createRange();
  range.setStart(nodes[0], 0);
  const last = partial ? nodes[0] : nodes.at(-1)!;
  range.setEnd(last, last.data.length);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}
it('recognizes the entire visible formula selected by text endpoints, without requiring wrapper boundaries', async () => {
  const view = await mount();
  textSelection(host.querySelector('.katex-html')!);
  expect(document.getSelection()!.toString()).toBe('x+1');
  expect(selectedCopy(view)?.markdown).toBe('$x+1$');
});
it('keeps a genuinely partial formula as visible characters', async () => {
  const view = await mount();
  textSelection(host.querySelector('.katex-html')!, true);
  expect(selectedCopy(view)?.markdown).toBe('x');
});
it('preserves formatting when the selected visible text is contained inside a strong element', async () => {
  const view = await mount();
  textSelection(host.querySelector('.prototype-strong')!);
  const content = selectedCopy(view)!;
  expect(content.markdown).toBe('**加粗文字**');
  const html = document.createElement('div');
  html.innerHTML = content.html;
  expect(html.querySelector('strong')?.textContent).toBe('加粗文字');
});
it('preserves all enclosing inline formats for a selection inside a formatted link', async () => {
  const view = await mount('# 顶\n\n***[嵌套文字](https://example.org)***\n\n尾段');
  textSelection(host.querySelector('[data-link-target]')!);
  const content = selectedCopy(view)!;
  const html = document.createElement('div');
  html.innerHTML = content.html;
  expect(html.querySelector('strong em a, em strong a')?.textContent).toBe('嵌套文字');
  expect(content.markdown).toContain('https://example.org');
});
it.each([
  ['**加粗文字**', '.prototype-strong'],
  ['`users`', '.prototype-inline-code'],
  ['==重点==', '.prototype-highlight'],
  ['H~2~O', '.prototype-sub'],
  ['[名字](target.md)', '.prototype-link'],
  ['<u>下划线</u>', '.prototype-underline'],
  ['<mark>重点</mark>', '.prototype-highlight'],
])('copies visible source markers once when editing %s', async (format, selector) => {
  const source = '# 顶\n\n' + format + '\n\n尾段';
  const view = await mount(source);
  const from = source.indexOf(format) + (format.startsWith('H') ? 2 : 1);
  await act(async () => view.dispatch({ selection: { anchor: from } }));
  const element = host.querySelector(selector)!;
  textSelection(element);
  const visible = document.getSelection()!.toString();
  const expected = format.startsWith('H') ? '~2~' : format;
  expect(visible).toBe(expected);
  expect(selectedCopy(view)?.markdown).toBe(expected);
  expect(view.state.doc.toString()).toBe(source);
});
it('keeps the source directory when copying a link inside an embedded note', async () => {
  const view = await mount('# 顶\n\n![[sub/child.md]]\n\n尾段', {
    notePath: 'D:/generated/root.md',
    resolveNote: () => ({ path: 'D:/generated/sub/child.md', source: '[后续参考](other.md#标题)' }),
  });
  textSelection(host.querySelector('.note-embed-body a')!);
  expect(decodeURIComponent(selectedCopy(view)?.markdown ?? '')).toContain(
    'D:/generated/sub/other.md#标题',
  );
});
it.each([
  ['==重点==', '.prototype-highlight', 'mark'],
  ['H~2~O', '.prototype-sub', 'sub'],
  ['x^2^', '.prototype-sup', 'sup'],
  ['<u>下划线</u>', '.prototype-underline', 'u'],
])('retains inactive inline semantics when copying %s', async (source, selector, tag) => {
  const view = await mount('# 顶\n\n' + source + '\n\n尾段');
  textSelection(host.querySelector(selector)!);
  const copied = selectedCopy(view)!;
  const result = document.createElement('div');
  result.innerHTML = renderMarkdown(copied.markdown);
  expect(result.querySelector(tag)?.textContent).toBe(document.getSelection()!.toString());
});
