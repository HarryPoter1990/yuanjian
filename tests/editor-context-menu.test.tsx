// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
let host: HTMLDivElement, root: Root;
let ref = createRef<MarkdownEditorHandle>();
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let write: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>,
  read: ReturnType<typeof vi.fn<() => Promise<string>>>;
let readItems: ReturnType<typeof vi.fn<() => Promise<ClipboardItem[]>>>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  write = vi.fn(async () => {});
  read = vi.fn(async () => '粘贴文字');
  readItems = vi.fn(async () => []);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: write, readText: read, read: readItems },
  });
  host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  root = createRoot(host);
  ref = createRef<MarkdownEditorHandle>();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
async function mount(value: string, live = false, onImage?: (file: File) => Promise<string>) {
  const error = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={value}
        mode={live ? 'live' : 'source'}
        settings={defaultSettings}
        initialCursor={value.length}
        onChange={() => {}}
        onError={error}
        onImage={onImage}
      />,
    ),
  );
  return { view: ref.current!.getView()!, error };
}
async function open(target?: Element) {
  await act(async () => {
    ref.current!.getView()!.focus();
    (target ?? host.querySelector('.cm-content'))!.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      }),
    );
  });
  return host.querySelector<HTMLElement>('[role="menu"]')!;
}
async function click(label: string) {
  await act(async () => {
    const item = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.querySelector('span')?.textContent === label,
    )!;
    expect(item).toBeDefined();
    item.click();
    await Promise.resolve();
  });
}
describe('local editor context actions', () => {
  it('shows the actual common shortcuts', async () => {
    await mount('正文');
    const menu = await open();
    expect([...menu.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual([
      'Ctrl+Z',
      'Ctrl+Y',
      'Ctrl+X',
      'Ctrl+C',
      'Ctrl+V',
      'Ctrl+Shift+V',
      'Ctrl+A',
    ]);
  });
  it('uses ordinary Paste to read rich HTML and preserves its formatting', async () => {
    readItems.mockResolvedValue([
      {
        types: ['text/html', 'text/plain'],
        presentationStyle: 'unspecified',
        getType: async (type) =>
          new Blob([type === 'text/html' ? '<b>格式</b>' : '格式'], { type }),
      },
    ]);
    const { view } = await mount('甲乙丙');
    await act(async () => view.dispatch({ selection: { anchor: 1, head: 2 } }));
    await open();
    await click('粘贴');
    await act(async () => vi.waitFor(() => expect(view.state.doc.toString()).toBe('甲**格式**丙')));
    expect(readItems).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });
  it('routes image ClipboardItems through the same byte-identity conversion and import path', async () => {
    readItems.mockResolvedValue([
      {
        types: ['text/html', 'text/plain', 'image/png'],
        presentationStyle: 'unspecified',
        getType: async (type) =>
          new Blob(
            [
              type === 'text/html'
                ? '<p>前<img src="data:image/png;base64,eA==" alt="图">后</p>'
                : type === 'text/plain'
                  ? '前图后'
                  : 'x',
            ],
            { type },
          ),
      },
    ]);
    const image = vi.fn(async () => 'assets/menu.png');
    const { view } = await mount('', false, image);
    await open();
    await click('粘贴');
    await act(async () =>
      vi.waitFor(() => expect(view.state.doc.toString()).toBe('前![图](assets/menu.png)后')),
    );
    expect(image).toHaveBeenCalledOnce();
  });
  it('explicitly reports a plain-text fallback when rich clipboard access is denied', async () => {
    readItems.mockRejectedValue(new Error('generated permission denial'));
    read.mockResolvedValue('纯文字');
    const { view, error } = await mount('甲乙丙');
    await act(async () => view.dispatch({ selection: { anchor: 1, head: 2 } }));
    await open();
    await click('粘贴');
    await act(async () => vi.waitFor(() => expect(view.state.doc.toString()).toBe('甲纯文字丙')));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/纯文字.*格式.*未读取/));
  });
  it('retains source when copying for Cut fails', async () => {
    write.mockRejectedValue(new Error('generated copy failure'));
    const { view, error } = await mount('甲乙丙');
    await act(async () => view.dispatch({ selection: { anchor: 1, head: 2 } }));
    await open();
    await click('剪切');
    expect(view.state.doc.toString()).toBe('甲乙丙');
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/copy failure/));
  });
  it('preserves the source selection while copying and restores focus with Escape', async () => {
    const { view } = await mount('甲乙丙');
    await act(async () => view.dispatch({ selection: { anchor: 1, head: 2 } }));
    await open();
    expect(host.querySelector('[aria-label="正文编辑菜单"]')).not.toBeNull();
    await click('复制');
    expect(write).toHaveBeenCalledWith('乙');
    expect(view.state.doc.toString()).toBe('甲乙丙');
    const menu = await open();
    await act(async () =>
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(view.hasFocus).toBe(true);
  });
  it('does not delete newer source if clipboard copying finishes after an intervening edit', async () => {
    let finish!: () => void;
    write.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { view, error } = await mount('甲乙丙');
    await act(async () => view.dispatch({ selection: { anchor: 1, head: 2 } }));
    await open();
    await click('剪切');
    await act(async () =>
      view.dispatch({ changes: { from: 1, insert: '新输入' }, userEvent: 'input.type' }),
    );
    await act(async () => finish());
    expect(view.state.doc.toString()).toBe('甲新输入乙丙');
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/未剪切/));
  });
  it('keeps edits inside a pending plain paste selection using the same insertion guard', async () => {
    let finish!: (value: string) => void;
    read.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { view } = await mount('前ABCDEF后');
    await act(async () => view.dispatch({ selection: { anchor: 1, head: 7 } }));
    await open();
    await click('粘贴为纯文本');
    await act(async () =>
      view.dispatch({ changes: { from: 4, insert: '新输入' }, userEvent: 'input.type' }),
    );
    await act(async () => finish('粘贴文字'));
    expect(view.state.doc.toString()).toBe('前ABC新输入DEF粘贴文字后');
    expect(readItems).not.toHaveBeenCalled();
  });
  it('copies exact code including its trailing newline', async () => {
    const source = '# 顶\n\n```js\nconst x = 1;\n```\n\n尾段';
    const { view } = await mount(source, true);
    await open(host.querySelector('.code-line-content')!);
    await click('复制代码');
    expect(write).toHaveBeenCalledWith('const x = 1;\n');
    expect(view.state.doc.toString()).toBe(source);
  });
  it('copies a grid cell and adds a row through the existing table action', async () => {
    const { view } = await mount('| A | B |\n| --- | --- |\n| 旧 | 值 |\n\n尾段', true);
    const cell = host.querySelector<HTMLTextAreaElement>(
      'textarea[data-row="1"][data-column="0"]',
    )!;
    await open(cell);
    await click('复制单元格');
    expect(write).toHaveBeenCalledWith('旧');
    await open(cell);
    await click('在下方插入行');
    expect(view.state.doc.toString()).toContain('| 旧 | 值 |\n|  |  |');
  });
});
