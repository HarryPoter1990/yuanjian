// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
let host: HTMLDivElement, root: Root;
let ref = createRef<MarkdownEditorHandle>();
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
  ref = createRef<MarkdownEditorHandle>();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(value: string) {
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={value}
        mode="source"
        settings={defaultSettings}
        onChange={() => {}}
      />,
    ),
  );
  return ref.current!.getView()!;
}
const input = (name: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const button = (name: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
async function fill(name: string, value: string) {
  await act(async () => {
    const element = input(name);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('compact Chinese document search', () => {
  it('keeps focus in the search bar when replace-all disables its focused action, then Escape returns to the editor', async () => {
    const view = await mount('one one');
    await act(async () => ref.current!.command('replace'));
    await fill('查找正文', 'one');
    await fill('替换为', 'two');
    await act(async () => {
      button('全部替换').focus();
      button('全部替换').click();
    });
    expect(document.activeElement).toBe(input('查找正文'));
    await act(async () =>
      input('查找正文').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('.cm-search')).toBeNull();
    expect(view.hasFocus).toBe(true);
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe('one one');
  });
  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ])(
    'does not consume IME confirmation or replace source during $isComposing/$keyCode',
    async (options) => {
      const view = await mount('one one');
      await act(async () => ref.current!.command('replace'));
      await fill('查找正文', 'one');
      await fill('替换为', '候选');
      const element = input('替换为');
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...options,
      });
      await act(async () => {
        element.focus();
        element.dispatchEvent(event);
      });
      expect(view.state.doc.toString()).toBe('one one');
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(element);
    },
  );
  it('opens Find as a compact bar and expands replacement only on request', async () => {
    await mount('正文');
    await act(async () => ref.current!.command('find'));
    expect(input('查找正文')).not.toBeNull();
    expect(document.activeElement).toBe(input('查找正文'));
    expect(host.querySelector('.cm-search-replace')?.hasAttribute('hidden')).toBe(true);
    await act(async () => button('展开替换').click());
    expect(host.querySelector('.cm-search-replace')?.hasAttribute('hidden')).toBe(false);
    expect(input('替换为')).not.toBeNull();
  });
  it('counts hits, navigates both ways and closes with Escape without changing source', async () => {
    const source = '中文 一\n中文 二';
    const view = await mount(source);
    await act(async () => ref.current!.command('find'));
    await fill('查找正文', '中文');
    expect(host.querySelector('[aria-label="查找结果"]')?.textContent).toContain('/ 2');
    await act(async () => button('下一项').click());
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      '中文',
    );
    const first = view.state.selection.main.from;
    await act(async () => button('下一项').click());
    expect(view.state.selection.main.from).not.toBe(first);
    await act(async () => button('上一项').click());
    expect(view.state.selection.main.from).toBe(first);
    await act(async () =>
      input('查找正文').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('.cm-search')).toBeNull();
    expect(view.hasFocus).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
  it('offers case, whole-word and regexp options with a nearby invalid-pattern message', async () => {
    await mount('Foo foo food');
    await act(async () => ref.current!.command('find'));
    await fill('查找正文', 'foo');
    expect(host.querySelector('[aria-label="查找结果"]')?.textContent).toContain('/ 3');
    await act(async () => button('查找选项').click());
    await act(async () => input('整词匹配').click());
    expect(host.querySelector('[aria-label="查找结果"]')?.textContent).toContain('/ 2');
    await act(async () => input('区分大小写').click());
    expect(host.querySelector('[aria-label="查找结果"]')?.textContent).toContain('/ 1');
    await act(async () => input('正则表达式').click());
    await fill('查找正文', '(');
    expect(host.querySelector('[aria-label="查找结果"]')?.textContent).toContain('无效');
    expect(button('下一项').disabled).toBe(true);
  });
  it('replaces through the existing editor history and keeps undo available', async () => {
    const view = await mount('one one');
    await act(async () => ref.current!.command('replace'));
    await fill('查找正文', 'one');
    await fill('替换为', 'two');
    await act(async () => button('全部替换').click());
    expect(view.state.doc.toString()).toBe('two two');
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe('one one');
  });
  it('uses Ctrl+H to open replacement from the editor itself', async () => {
    const view = await mount('正文');
    await act(async () =>
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(input('替换为')).not.toBeNull();
    expect(host.querySelector('.cm-search-replace')?.hasAttribute('hidden')).toBe(false);
  });
});
