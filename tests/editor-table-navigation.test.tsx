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
async function mount(source: string) {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={source}
        mode="live"
        settings={defaultSettings}
        initialCursor={source.length}
        onChange={onChange}
      />,
    ),
  );
  return { view: ref.current!.getView()!, onChange };
}
const cell = (row: number, column: number) =>
  host.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-column="${column}"]`)!;
async function key(input: HTMLInputElement, value: string, shiftKey = false, isComposing = false) {
  await act(async () => {
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        shiftKey,
        isComposing,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
describe('table keyboard navigation and short rows', () => {
  it.each([
    ['| 旧 |', '| 旧 | 新字 |'],
    ['旧', '旧 | 新字'],
    [' | 旧 |  ', ' | 旧 | 新字 |  '],
    ['| 旧', '| 旧 | 新字'],
  ])('writes a padded cell into %j without changing other source', async (row, expected) => {
    const source = `开头  保留\n\n| A  | B |\n| :------ | ---: |\n${row}\n\n尾段  保留`;
    const { view, onChange } = await mount(source);
    const input = cell(1, 1);
    await act(async () => {
      input.focus();
      input.value = '新字';
      input.setSelectionRange(1, 1);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.state.doc.toString()).toBe(source.replace(row + '\n\n尾段', expected + '\n\n尾段'));
    expect(onChange).toHaveBeenCalledOnce();
    expect(cell(1, 1)).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe(source);
  });
  it('pads intervening cells only on the edited short row', async () => {
    const source = '| A | B | C |\n| --- | --- | --- |\n| 旧 |\n| 后 | 留 | 下 |\n\n尾段';
    const { view } = await mount(source);
    const input = cell(1, 2);
    await act(async () => {
      input.focus();
      input.value = '新字';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.state.doc.toString()).toBe(source.replace('| 旧 |\n', '| 旧 | | 新字 |\n'));
  });
  it('moves between cells in both directions and appends one row at the final Tab without reformatting existing rows', async () => {
    const source = '| A  | B |\n| :------ | ---: |\n| 一   | 二 |\n\n尾段';
    const { view } = await mount(source);
    await key(cell(0, 0), 'Tab');
    expect(document.activeElement).toBe(cell(0, 1));
    await key(cell(0, 1), 'Tab', true);
    expect(document.activeElement).toBe(cell(0, 0));
    await key(cell(1, 1), 'Tab');
    expect(view.state.doc.toString()).toBe(
      source.replace('| 一   | 二 |', '| 一   | 二 |\n|  |  |'),
    );
    expect(document.activeElement).toBe(cell(2, 0));
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe(source);
  });
  it('does not navigate or append a row while confirming an input-method candidate', async () => {
    const source = '| A | B |\n| --- | --- |\n| 一 | 二 |\n\n尾段';
    const { view } = await mount(source);
    const last = cell(1, 1);
    await key(last, 'Tab', false, true);
    expect(document.activeElement).toBe(last);
    expect(view.state.doc.toString()).toBe(source);
  });
});
