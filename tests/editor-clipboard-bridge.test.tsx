// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
let host: HTMLDivElement,
  root: Root,
  written: ClipboardItem[] = [],
  plain = '';
let read: ReturnType<typeof vi.fn<() => Promise<ClipboardItem[]>>>;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const source = '| A | B |\n| --- | --- |\n| 旧 | 值 |\n\n尾段';
const text = (blob: Blob): Promise<string> =>
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
  plain = '';
  written = [];
  read = vi.fn(async () => [
    new ClipboardItem({ 'text/plain': new Blob([plain], { type: 'text/plain' }) }),
  ]);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async (items: ClipboardItem[]) => {
        written = items;
      },
      writeText: async () => {},
      read,
      readText: async () => plain,
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
async function mount(value = source) {
  const reference = createRef<MarkdownEditorHandle>(),
    error = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={reference}
        value={value}
        mode="live"
        initialCursor={value.length}
        settings={defaultSettings}
        onChange={() => {}}
        onError={error}
      />,
    ),
  );
  return { view: reference.current!.getView()!, error };
}
const cell = () =>
  host.querySelector<HTMLTextAreaElement>('textarea[data-row="1"][data-column="0"]')!;
async function context() {
  const input = cell();
  input.focus();
  input.select();
  await act(async () =>
    input.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      }),
    ),
  );
}
const menu = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.querySelector('span')?.textContent === label,
  )!;
it.each(['toolbar', 'context'])(
  'copies the entire table as Markdown and clean HTML using %s',
  async (kind) => {
    const { view } = await mount();
    if (kind === 'context') {
      await context();
      await act(async () => menu('复制整个表格').click());
    } else
      await act(async () => {
        cell().focus();
        [...host.querySelectorAll<HTMLButtonElement>('.table-toolbar button')]
          .find((button) => button.textContent === '复制整表')!
          .click();
      });
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(await text(await written[0].getType('text/plain'))).toBe(source.split('\n\n')[0]);
    const html = await text(await written[0].getType('text/html'));
    expect(html).toContain('<table>');
    expect(html).toContain('旧');
    expect(html).not.toMatch(/<textarea|<input|<button|table-toolbar/);
    expect(view.state.doc.toString()).toBe(source);
  },
);
it('uses normal context Paste for a matrix and waits for overwrite confirmation', async () => {
  const { view } = await mount();
  plain = '甲\t1\n乙\t2';
  await context();
  await act(async () => menu('粘贴').click());
  await vi.waitFor(() => expect(host.querySelector('[role="alertdialog"]')).not.toBeNull());
  expect(view.state.doc.toString()).toBe(source);
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '覆盖并粘贴')!
      .click(),
  );
  expect(cell().value).toBe('甲');
  expect(
    host.querySelector<HTMLTextAreaElement>('textarea[data-row="2"][data-column="0"]')?.value,
  ).toBe('乙');
});
it('keeps explicitly plain context Paste in one cell with literal tabs and line breaks', async () => {
  await mount();
  plain = '甲\t1\n乙\t2';
  await context();
  await act(async () => menu('粘贴为纯文本').click());
  await vi.waitFor(() => expect(cell().value).toBe(plain));
  expect(read).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  expect(host.querySelectorAll('textarea')).toHaveLength(4);
});
it('does not overwrite a different cell selection made while clipboard reading is pending', async () => {
  const original = source.replace('| 旧 | 值 |', '| ABCDEF | 值 |');
  const { view, error } = await mount(original);
  let finish!: (items: ClipboardItem[]) => void;
  read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await context();
  await act(async () => menu('粘贴').click());
  cell().setSelectionRange(2, 5);
  await act(async () =>
    finish([new ClipboardItem({ 'text/plain': new Blob(['新内容'], { type: 'text/plain' }) })]),
  );
  expect(cell().value).toBe('ABCDEF');
  expect(view.state.doc.toString()).toBe(original);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('选区'));
});
it('converts external webpage table HTML through the shared paste converter', async () => {
  const { view } = await mount('尾段');
  vi.spyOn(view, 'posAtCoords').mockReturnValue(0);
  await act(async () => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        files: [],
        types: ['text/html', 'text/plain'],
        getData: (type: string) =>
          type === 'text/html' ? '<table><tr><td>甲</td><td>1</td></tr></table>' : '甲\t1',
      },
    });
    view.contentDOM.dispatchEvent(event);
  });
  await vi.waitFor(() => expect(view.state.doc.toString()).toContain('| 甲 | 1 |'));
  expect(view.state.doc.toString()).toContain('尾段');
});
it('blocks non-image file fallback instead of inserting binary text into the document', async () => {
  const { view, error } = await mount('正文保留');
  vi.spyOn(view, 'posAtCoords').mockReturnValue(0);
  await act(async () => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        files: [new File(['binary bytes'], 'archive.bin', { type: 'application/octet-stream' })],
        types: ['Files'],
        getData: () => '',
      },
    });
    view.contentDOM.dispatchEvent(event);
  });
  expect(view.state.doc.toString()).toBe('正文保留');
  expect(error).toHaveBeenCalledWith(expect.stringContaining('非图片文件未插入正文'));
});
it('keeps an internal selection drag on CodeMirror move semantics despite an HTML flavor', async () => {
  const { view } = await mount('甲\n\n乙');
  await act(async () => view.dispatch({ selection: { anchor: 0, head: 1 } }));
  vi.spyOn(view, 'posAtCoords').mockReturnValue(4);
  const values: Record<string, string> = {
    'text/html': '<table><tr><td>不应转换</td></tr></table>',
  };
  const transfer = {
    files: [],
    types: ['Text', 'text/plain', 'text/html'],
    getData: vi.fn((type: string) => values[type] ?? ''),
    setData: (type: string, value: string) => {
      values[type] = value;
    },
    effectAllowed: 'copyMove',
  };
  const event = (type: string) => {
    const value = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
    });
    Object.defineProperty(value, 'dataTransfer', { value: transfer });
    return value;
  };
  await act(async () => view.contentDOM.dispatchEvent(event('dragstart')));
  await act(async () => view.contentDOM.dispatchEvent(event('drop')));
  expect(view.state.doc.toString()).toBe('\n\n乙甲');
  expect(transfer.getData).not.toHaveBeenCalledWith('text/html');
});
