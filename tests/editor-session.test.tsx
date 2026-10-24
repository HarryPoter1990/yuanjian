// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { EditorSession, MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';

let host: HTMLDivElement, root: Root;
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
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe('in-memory editor session reconstruction', () => {
  it('restores document history, reversed selection and scroll using fresh callbacks after unmount', async () => {
    const first = createRef<MarkdownEditorHandle>();
    let snapshot: EditorSession | undefined;
    const oldChange = vi.fn();
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={first}
          value="原文"
          mode="source"
          settings={defaultSettings}
          onChange={oldChange}
          onSessionSave={(value) => {
            snapshot = value;
          }}
        />,
      ),
    );
    await act(async () => first.current!.insert('新增'));
    const original = first.current!.getView()!;
    await act(async () => original.dispatch({ selection: { anchor: 4, head: 2 } }));
    original.scrollDOM.scrollTop = 42;
    await act(async () => root.render(null));
    expect(snapshot).toBeDefined();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    const second = createRef<MarkdownEditorHandle>();
    const newChange = vi.fn();
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={second}
          value="新增原文"
          mode="source"
          settings={defaultSettings}
          onChange={newChange}
          initialSession={snapshot}
        />,
      ),
    );
    const restored = second.current!.getView()!;
    expect(restored).not.toBe(original);
    expect(restored.state.selection.main.anchor).toBe(4);
    expect(restored.state.selection.main.head).toBe(2);
    expect(restored.scrollDOM.scrollTop).toBe(42);
    await act(async () => second.current!.command('undo'));
    expect(restored.state.doc.toString()).toBe('原文');
    expect(newChange).toHaveBeenLastCalledWith('原文');
    expect(oldChange).toHaveBeenCalledOnce();
    await act(async () => second.current!.command('redo'));
    expect(restored.state.doc.toString()).toBe('新增原文');
  });
  it('accepts equivalent CRLF session text but rejects changed source without reusing stale undo', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    let snapshot: EditorSession | undefined;
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={'原\n文'}
          mode="source"
          settings={defaultSettings}
          onChange={() => {}}
          onSessionSave={(value) => {
            snapshot = value;
          }}
        />,
      ),
    );
    await act(async () => ref.current!.insert('新增'));
    await act(async () => root.render(null));
    const error = vi.fn();
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={'新增原\r\n文'}
          mode="source"
          settings={defaultSettings}
          onChange={() => {}}
          onError={error}
          initialSession={snapshot}
        />,
      ),
    );
    await act(async () => ref.current!.command('undo'));
    expect(ref.current!.getView()!.state.doc.toString()).toBe('原\n文');
    expect(error).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value="外部新正文"
          mode="source"
          settings={defaultSettings}
          onChange={() => {}}
          onError={error}
          initialSession={snapshot}
        />,
      ),
    );
    expect(ref.current!.command('undo')).toBe(false);
    expect(ref.current!.getView()!.state.doc.toString()).toBe('外部新正文');
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/正文.*变化.*撤销/));
  });
  it('does not complete an old asynchronous image insertion into a reconstructed note', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    let finish!: (value: string) => void;
    const image = new Promise<string>((resolve) => {
      finish = resolve;
    });
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value="A"
          mode="source"
          settings={defaultSettings}
          onChange={() => {}}
          onImage={() => image}
        />,
      ),
    );
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['image'], 'a.png', { type: 'image/png' })], getData: () => '' },
    });
    await act(async () => ref.current!.getView()!.contentDOM.dispatchEvent(paste));
    await act(async () => root.render(null));
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value="B"
          mode="source"
          settings={defaultSettings}
          onChange={() => {}}
        />,
      ),
    );
    await act(async () => {
      finish('assets/a.png');
      await image;
    });
    expect(ref.current!.getView()!.state.doc.toString()).toBe('B');
  });
  it('exposes a heading level interface that changes selected lines and can return them to body text', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const source = '# 一\n二\n\n尾段';
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={source}
          mode="source"
          settings={defaultSettings}
          onChange={() => {}}
        />,
      ),
    );
    const view = ref.current!.getView()!;
    expect(ref.current!.getHeadingLevel()).toBe(1);
    await act(async () =>
      view.dispatch({ selection: { anchor: 0, head: source.indexOf('\n\n') } }),
    );
    await act(async () => ref.current!.setHeading(3));
    expect(view.state.doc.toString()).toBe('### 一\n### 二\n\n尾段');
    expect(ref.current!.getHeadingLevel()).toBe(3);
    await act(async () => ref.current!.setHeading(0));
    expect(view.state.doc.toString()).toBe('一\n二\n\n尾段');
  });
});
