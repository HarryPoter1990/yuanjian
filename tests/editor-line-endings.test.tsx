// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import { undo, redo } from '@codemirror/commands';
let host: HTMLDivElement, root: Root;
let ref = createRef<MarkdownEditorHandle>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
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
  vi.restoreAllMocks();
});
describe('editor line-ending synchronization', () => {
  it.each(['a\r\nb\nc\rd', 'a\rb\r', 'a\nb\n'])(
    'opens mixed and single line endings without manufacturing edits: %j',
    async (source) => {
      const onChange = vi.fn();
      await act(async () =>
        root.render(
          <MarkdownEditor
            ref={ref}
            value={source}
            mode="live"
            settings={defaultSettings}
            onChange={onChange}
          />,
        ),
      );
      expect(ref.current?.getView()?.state.doc.toString()).toBe(source.replace(/\r\n?|\n/g, '\n'));
      expect(onChange).not.toHaveBeenCalled();
    },
  );
  it('does not report an edit just by opening a CRLF note', async () => {
    const onChange = vi.fn(),
      source = '### 标题\r\n\r\n普通正文\r\n';
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={source}
          mode="live"
          settings={defaultSettings}
          onChange={onChange}
        />,
      ),
    );
    expect(ref.current?.getView()?.state.doc.toString()).toBe(source.replace(/\r\n/g, '\n'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('preserves the full selection when a saved note returns equivalent CRLF text', async () => {
    const onChange = vi.fn(),
      source = '### 标题\n\n普通正文\n';
    const render = (value: string) =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={value}
          mode="live"
          settings={defaultSettings}
          onChange={onChange}
        />,
      );
    await act(async () => render(source));
    const view = ref.current!.getView()!;
    await act(async () => view.dispatch({ selection: { anchor: 1, head: 4 } }));
    const originalDoc = view.state.doc;
    await act(async () => render(source.replace(/\n/g, '\r\n')));
    expect(view.state.doc).toBe(originalDoc);
    expect(view.state.selection.main.anchor).toBe(1);
    expect(view.state.selection.main.head).toBe(4);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('clamps restored cursors to the normalized initial document length', async () => {
    const source = '标题\r\n正文\r\n';
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={source}
          initialCursor={source.length}
          mode="live"
          settings={defaultSettings}
          onChange={() => {}}
        />,
      ),
    );
    const state = ref.current!.getView()!.state;
    expect(state.selection.main.head).toBe(state.doc.length);
  });
  it('keeps editing history intact after an equivalent CRLF save response', async () => {
    const onChange = vi.fn(),
      source = '### 标题\r\n\r\n普通正文\r\n';
    const render = (value: string) =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={value}
          mode="live"
          settings={defaultSettings}
          onChange={onChange}
        />,
      );
    await act(async () => render(source));
    const view = ref.current!.getView()!;
    await act(async () => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    await act(async () =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '新增' },
        selection: { anchor: view.state.doc.length + 2 },
        userEvent: 'input.type',
      }),
    );
    const edited = view.state.doc.toString(),
      doc = view.state.doc,
      cursor = view.state.selection.main.head;
    await act(async () => render(edited.replace(/\n/g, '\r\n')));
    expect(view.state.doc).toBe(doc);
    expect(view.state.selection.main.head).toBe(cursor);
    expect(onChange).toHaveBeenCalledTimes(1);
    await act(async () => expect(undo(view)).toBe(true));
    expect(view.state.doc.toString()).toBe(source.replace(/\r\n/g, '\n'));
    await act(async () => expect(redo(view)).toBe(true));
    expect(view.state.doc.toString()).toBe(edited);
  });
  it('clamps a cursor after a shorter CRLF external update', async () => {
    const onChange = vi.fn();
    const render = (value: string) =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={value}
          initialCursor={10}
          mode="live"
          settings={defaultSettings}
          onChange={onChange}
        />,
      );
    await act(async () => render('0123456789\n\n正文'));
    const view = ref.current!.getView()!;
    const next = 'a\r\nb\r\nc\r\nd\r\n';
    await act(async () => render(next));
    expect(view.state.doc.toString()).toBe('a\nb\nc\nd\n');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
