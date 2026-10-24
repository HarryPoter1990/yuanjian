// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { compoundClipboardToMarkdown } from '../src/editor/clipboard';
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
async function mount(onImage: (file: File) => Promise<string>) {
  const error = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value="前ABCDEF后"
        mode="source"
        settings={defaultSettings}
        onChange={() => {}}
        onImage={onImage}
        onError={error}
      />,
    ),
  );
  const view = ref.current!.getView()!;
  await act(async () => view.dispatch({ selection: { anchor: 1, head: 7 } }));
  return { view, error };
}
async function paste(name = 'a.png') {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [new File(['x'], name, { type: 'image/png' })],
      getData: (type: string) =>
        type === 'text/html'
          ? `<p>粘贴文字<img src="cid:${name}" alt="图">末尾</p>`
          : '粘贴文字图末尾',
    },
  });
  await act(async () => {
    ref.current!.getView()!.contentDOM.dispatchEvent(event);
    await Promise.resolve();
  });
}
describe('asynchronous paste does not overwrite edits or infer remote identity', () => {
  it.each([
    { name: 'insert', change: { from: 4, insert: '保留新输入' } },
    { name: 'replace', change: { from: 3, to: 5, insert: '保留新替换' } },
    { name: 'delete', change: { from: 3, to: 5, insert: '' } },
  ])('preserves an intervening $name inside the original selected range', async ({ change }) => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const { view, error } = await mount(() => pending);
    await paste();
    await act(async () => view.dispatch({ changes: change, userEvent: 'input.type' }));
    const before = view.state.doc.toString();
    await act(async () => {
      finish('assets/a.png');
      await pending;
    });
    expect(view.state.doc.toString()).toBe(
      before.slice(0, -1) + '粘贴文字![图](assets/a.png)末尾后',
    );
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/原选区.*变化.*保留/));
  });
  it.each([1, 7])(
    'retains new text exactly on boundary %i without falsely marking an internal conflict',
    async (position) => {
      let finish!: (value: string) => void;
      const pending = new Promise<string>((resolve) => {
        finish = resolve;
      });
      const { view, error } = await mount(() => pending);
      await paste();
      await act(async () =>
        view.dispatch({ changes: { from: position, insert: '边界新字' }, userEvent: 'input.type' }),
      );
      await act(async () => {
        finish('assets/a.png');
        await pending;
      });
      const inserted = '粘贴文字![图](assets/a.png)末尾';
      expect(view.state.doc.toString()).toBe(
        position === 1 ? '前边界新字' + inserted + '后' : '前' + inserted + '边界新字后',
      );
      expect(error).not.toHaveBeenCalled();
    },
  );
  it('does not let the completion of another pending paste overwrite either result or new typing', async () => {
    let first!: (value: string) => void, second!: (value: string) => void;
    const a = new Promise<string>((resolve) => {
      first = resolve;
    });
    const b = new Promise<string>((resolve) => {
      second = resolve;
    });
    const { view } = await mount((file) => (file.name === 'a.png' ? a : b));
    await paste('a.png');
    await act(async () => view.dispatch({ selection: { anchor: 3, head: 5 } }));
    await paste('b.png');
    await act(async () =>
      view.dispatch({ changes: { from: 4, insert: '新输入' }, userEvent: 'input.type' }),
    );
    await act(async () => {
      second('assets/b.png');
      await b;
    });
    await act(async () => {
      first('assets/a.png');
      await a;
    });
    const source = view.state.doc.toString();
    expect(source).toContain('新输入');
    expect(source.match(/assets\/a.png/g)).toHaveLength(1);
    expect(source.match(/assets\/b.png/g)).toHaveLength(1);
    expect(source.replace(/粘贴文字!\[图\]\(assets\/[ab]\.png\)末尾/g, '')).toBe(
      '前ABC新输入DEF后',
    );
  });
  it('does not infer matching image bytes from a coincident remote basename', async () => {
    const image = vi.fn(async () => 'assets/remote.png');
    const result = await compoundClipboardToMarkdown(
      '<p>前<img src="https://example.com/original/remote.png" alt="远图">后</p>',
      '前远图后',
      [new File(['other'], 'remote.png', { type: 'image/png' })],
      image,
    );
    expect(result.markdown).toBe('前![远图](https://example.com/original/remote.png)后');
    expect(image).not.toHaveBeenCalled();
    expect(result.notices.join('')).toContain('未全部本地化');
  });
});
