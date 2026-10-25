// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import { selectedCopy } from '../src/editor/clipboard-output';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
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
async function mount(value = '# 顶\n\n**加粗文字**\n\n$x+1$\n\n尾段') {
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={reference}
        value={value}
        initialCursor={value.length}
        mode="live"
        settings={defaultSettings}
        onChange={() => {}}
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
  textSelection(host.querySelector('.markdown-preview-block strong')!);
  const content = selectedCopy(view)!;
  expect(content.markdown).toBe('**加粗文字**');
  const html = document.createElement('div');
  html.innerHTML = content.html;
  expect(html.querySelector('strong')?.textContent).toBe('加粗文字');
});
it('preserves all enclosing inline formats for a selection inside a formatted link', async () => {
  const view = await mount('# 顶\n\n***[嵌套文字](https://example.org)***\n\n尾段');
  textSelection(host.querySelector('.markdown-preview-block a')!);
  const content = selectedCopy(view)!;
  const html = document.createElement('div');
  html.innerHTML = content.html;
  expect(html.querySelector('strong em a, em strong a')?.textContent).toBe('嵌套文字');
  expect(content.markdown).toContain('https://example.org');
});
