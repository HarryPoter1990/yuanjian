// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { readClipboardContent } from '../src/editor/clipboard-reader';
import { defaultSettings } from '../src/shared/defaults';

let host: HTMLDivElement, root: Root;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
function item(values: Record<string, string>, fail?: string): ClipboardItem {
  return {
    types: Object.keys(values),
    presentationStyle: 'unspecified',
    getType: async (type) => {
      if (type === fail) throw Error('生成读取失败');
      return new Blob([values[type]], { type });
    },
  };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
it('pastes rich and plain-only items in their original order without losing either', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      read: async () => [
        item({ 'text/html': '<p><b>第一项</b></p>', 'text/plain': '第一项' }),
        item({ 'text/plain': '第二项纯文字' }),
        item({ 'text/html': '<p>第三项</p>' }),
      ],
      readText: async () => '不应全局回退',
    },
  });
  const reference = createRef<MarkdownEditorHandle>();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={reference}
        value=""
        mode="source"
        settings={defaultSettings}
        onChange={() => {}}
      />,
    ),
  );
  await act(async () =>
    host.querySelector('.cm-content')!.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      }),
    ),
  );
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((button) => button.querySelector('span')?.textContent === '粘贴')!
      .click(),
  );
  await vi.waitFor(() =>
    expect(reference.current!.getView()!.state.doc.toString()).toBe(
      '**第一项**\n\n第二项纯文字\n\n第三项',
    ),
  );
});
it('retains successful items and plain fallback when one HTML representation fails', async () => {
  const fallback = vi.fn(async () => '不应丢掉其余项');
  const result = await readClipboardContent({
    read: async () => [
      item({ 'text/plain': '先前项' }),
      item({ 'text/html': '<b>格式</b>', 'text/plain': '该项原文' }, 'text/html'),
      item({ 'text/plain': '后续项' }),
    ],
    readText: fallback,
  });
  expect(result.items.map((part) => part.plain)).toEqual(['先前项', '该项原文', '后续项']);
  expect(result.notices.join(' ')).toContain('第 2 项');
  expect(fallback).not.toHaveBeenCalled();
});
it('makes plain-only intent skip rich reads and preserve the exact plain value', async () => {
  const rich = vi.fn(async () => [item({ 'text/html': '<b>不应读取</b>' })]);
  const result = await readClipboardContent({ read: rich, readText: async () => '一\n\t二' }, true);
  expect(result.items).toEqual([{ html: '', plain: '一\n\t二', files: [] }]);
  expect(rich).not.toHaveBeenCalled();
});
it('reports a rich-access fallback and never disguises plain text as full fidelity', async () => {
  const result = await readClipboardContent({
    read: async () => {
      throw Error('拒绝');
    },
    readText: async () => '文字保留',
  });
  expect(result.items[0].plain).toBe('文字保留');
  expect(result.notices.join(' ')).toMatch(/纯文字.*格式.*未读取/);
});
