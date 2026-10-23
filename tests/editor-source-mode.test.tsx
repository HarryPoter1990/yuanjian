// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { livePreviewField } from '../src/editor/live-preview';
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
async function mount(source: string, cursor = source.length) {
  const onChange = vi.fn();
  const render = (value: string, mode: 'source' | 'live') =>
    root.render(
      <MarkdownEditor
        value={value}
        onChange={onChange}
        mode={mode}
        settings={defaultSettings}
        initialCursor={cursor}
        ref={ref}
      />,
    );
  await act(async () => render(source, 'source'));
  return { view: ref.current!.getView()!, onChange, render };
}
describe('source mode keeps only visible editor work', () => {
  it('does not retain invisible Markdown blocks while opening, typing or selecting source', async () => {
    const source = '# 标题\n\n正文 **内容**\n\n尾段';
    const { view } = await mount(source);
    expect(view.state.field(livePreviewField).blocks).toEqual([]);
    await act(async () => ref.current!.insert('追加'));
    await act(async () => view.dispatch({ selection: { anchor: 0, head: 4 } }));
    expect(view.state.field(livePreviewField).blocks).toEqual([]);
    expect(view.state.doc.toString()).toBe(source + '追加');
    expect(host.querySelector('.markdown-preview-block')).toBeNull();
  });
  it('rebuilds the latest global references and heading IDs when returning to live mode and preserves undo', async () => {
    const source = '# 重复\n\n# 重复\n\n[参考][ref]\n\n[ref]: https://example.com/one\n\n尾段';
    const { view, render, onChange } = await mount(source);
    const from = source.indexOf('/one');
    await act(async () =>
      view.dispatch({
        changes: [
          { from: source.indexOf('重复'), to: source.indexOf('重复') + 2, insert: '新重复' },
          {
            from: source.lastIndexOf('重复'),
            to: source.lastIndexOf('重复') + 2,
            insert: '新重复',
          },
          { from, to: from + 4, insert: '/two' },
        ],
        userEvent: 'input.type',
      }),
    );
    const edited = view.state.doc.toString(),
      head = view.state.selection.main.head;
    await act(async () => render(edited, 'live'));
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/two');
    expect([...host.querySelectorAll('h1')].map((h) => h.id)).toEqual(['新重复', '新重复-1']);
    expect(view.state.selection.main.head).toBe(head);
    expect(onChange).toHaveBeenCalledTimes(1);
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe(source);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/one');
  });
  it('retains formula preview and shows raw metadata at the caret when source switches back to live', async () => {
    const formula = await mount('$x$', 2);
    expect(host.querySelector('.math-preview .katex')).not.toBeNull();
    expect(formula.view.state.field(livePreviewField).blocks).toEqual([]);
    const source = '---\ntags: [学习]\n---\n\n尾段';
    await act(async () => formula.render(source, 'source'));
    await act(async () => formula.view.dispatch({ selection: { anchor: 5 } }));
    await act(async () => formula.render(source, 'live'));
    expect(
      [...host.querySelectorAll('.cm-line')].some((line) => line.textContent === 'tags: [学习]'),
    ).toBe(true);
    expect(formula.view.state.selection.main.head).toBe(5);
    expect(formula.view.state.doc.toString()).toBe(source);
  });
});
