// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
let host: HTMLDivElement,
  root: Root,
  generation = 0;
let written: ClipboardItem[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const blobText = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ClipboardItem',
    class {
      readonly presentationStyle = 'unspecified';
      readonly types: string[];
      constructor(readonly values: Record<string, Blob | Promise<Blob>>) {
        this.types = Object.keys(values);
      }
      async getType(type: string) {
        return this.values[type];
      }
    },
  );
  written = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async (items: ClipboardItem[]) => {
        written = items;
      },
      read: async () => written,
      readText: async () => blobText(await written[0].getType('text/plain')),
      writeText: async () => {},
    },
  });
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
async function mount(
  source: string,
  notePath: string | null,
  onImage?: (file: File) => Promise<string>,
) {
  const reference = createRef<MarkdownEditorHandle>(),
    error = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        key={++generation}
        ref={reference}
        value={source}
        notePath={notePath}
        mode="source"
        settings={defaultSettings}
        initialCursor={source.length}
        onChange={() => {}}
        onImage={onImage}
        onError={error}
      />,
    ),
  );
  return { view: reference.current!.getView()!, error };
}
async function pasteMenu() {
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
}
it('copies a local image through its approved source and imports it under the target note', async () => {
  const asset = vi.fn(async () => 'note-asset://generated/image');
  Reflect.set(window, 'notes', { assetUrl: asset });
  const fetcher = vi.fn(
    async () => new Response(new Uint8Array([120]), { headers: { 'content-type': 'image/png' } }),
  );
  vi.stubGlobal('fetch', fetcher);
  const source = '前![本地图](assets/source.png)后';
  const first = await mount(source, 'D:/generated/source.md');
  await act(async () => first.view.dispatch({ selection: { anchor: 0, head: source.length } }));
  await act(async () =>
    first.view.contentDOM.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() => expect(written).toHaveLength(1));
  const html = await blobText(await written[0].getType('text/html'));
  expect(html).toContain('data:image/png;base64,eA==');
  expect(asset).toHaveBeenCalledWith('assets/source.png', 'D:/generated/source.md');
  expect(fetcher).toHaveBeenCalledOnce();
  const imported = vi.fn(async (_file: File) => 'assets/target.png');
  const second = await mount('目标\n\n', 'D:/elsewhere/target.md', imported);
  await pasteMenu();
  await vi.waitFor(() => expect(imported).toHaveBeenCalledOnce());
  expect(second.view.state.doc.toString()).toContain('前![本地图](assets/target.png)后');
  expect(second.view.state.doc.toString()).not.toContain('data:image');
  expect(imported.mock.calls[0][0].size).toBe(1);
});
it('imports a data image from a paste event even when clipboard files are empty', async () => {
  const imported = vi.fn(async (_file: File) => 'assets/event.png');
  const { view } = await mount('', 'D:/generated/target.md', imported);
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) =>
          type === 'text/html'
            ? '<p>前<img src="data:image/png;base64,eA==" alt="图">后</p>'
            : '前图后',
      },
    });
    view.contentDOM.dispatchEvent(event);
  });
  await vi.waitFor(() => expect(view.state.doc.toString()).toBe('前![图](assets/event.png)后'));
  expect(imported).toHaveBeenCalledOnce();
});
it.each(['```js\nHERE\n```', '$xHERE$'])(
  'treats ordinary rich paste as plain inside code or math: %s',
  async (template) => {
    const position = template.indexOf('HERE'),
      source = template.replace('HERE', '');
    const { view } = await mount(source, null);
    await act(async () => view.dispatch({ selection: { anchor: position } }));
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          files: [],
          getData: (type: string) => (type === 'text/html' ? '<b>富文本</b>' : '实际纯文字'),
        },
      });
      view.contentDOM.dispatchEvent(event);
    });
    expect(view.state.doc.toString()).toBe(
      source.slice(0, position) + '实际纯文字' + source.slice(position),
    );
  },
);
