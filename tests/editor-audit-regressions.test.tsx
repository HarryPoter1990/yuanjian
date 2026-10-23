// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';

let host: HTMLDivElement;
let root: Root;
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
  const onChange = vi.fn();
  const props = {
    value,
    mode: 'live' as const,
    settings: defaultSettings,
    onChange,
    initialCursor: value.length,
  };
  await act(async () => root.render(<MarkdownEditor {...props} ref={ref} />));
  return { view: ref.current!.getView()!, onChange, props };
}

describe('editor audit regressions', () => {
  it('changes only the clicked task inside a nested quote', async () => {
    const source = '- [ ] 顶层任务\n  > - [ ] 引用任务\n- [ ] 后续任务\n\n尾段';
    const { view } = await mount(source);
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    await act(async () => {
      boxes[1].checked = true;
      boxes[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(view.state.doc.toString()).toBe(source.replace('> - [ ] 引用任务', '> - [x] 引用任务'));
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe(source);
  });

  it('puts grid typing in the source immediately without replacing the focused input', async () => {
    const source = '| A  | B |\n| :------ | ---: |\n| 一   | 二 |\n\n尾段';
    const { view, onChange, props } = await mount(source);
    const input = host.querySelector<HTMLInputElement>('[aria-label="表格第 2 行第 1 列"]')!;
    await act(async () => {
      input.focus();
      input.value = '候选中文';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const expected = source.replace('| 一   |', '| 候选中文   |');
    expect(view.state.doc.toString()).toBe(expected);
    expect(onChange).toHaveBeenLastCalledWith(expected);
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[aria-label="表格第 2 行第 1 列"]')).toBe(input);
    await act(async () =>
      root.render(<MarkdownEditor {...props} value={expected} mode="source" ref={ref} />),
    );
    expect(view.state.doc.toString()).toBe(expected);
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe(source);
  });
});
