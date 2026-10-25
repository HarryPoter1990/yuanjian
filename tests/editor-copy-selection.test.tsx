// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import { markdownCopy } from '../src/editor/clipboard-output';
let host: HTMLDivElement, root: Root;
let write: ReturnType<typeof vi.fn<(items: ClipboardItem[]) => Promise<void>>>;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ClipboardItem',
    class {
      readonly presentationStyle = 'unspecified';
      readonly types: string[];
      constructor(readonly data: Record<string, Blob | Promise<Blob>>) {
        this.types = Object.keys(data);
      }
      async getType(type: string) {
        return this.data[type];
      }
    },
  );
  write = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write, writeText: vi.fn(async () => {}) },
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
async function mount(source: string, mode: 'live' | 'source' = 'live') {
  const reference = createRef<MarkdownEditorHandle>(),
    error = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={reference}
        value={source}
        initialCursor={source.length}
        mode={mode}
        settings={defaultSettings}
        onChange={() => {}}
        onError={error}
      />,
    ),
  );
  return { view: reference.current!.getView()!, error };
}
function select(node: Node, start?: number, end?: number) {
  const range = document.createRange();
  if (start === undefined) range.selectNodeContents(node);
  else {
    range.setStart(node, start);
    range.setEnd(node, end!);
  }
  const native = document.getSelection()!;
  native.removeAllRanges();
  native.addRange(range);
}
const item = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.querySelector('span')?.textContent === name,
  )!;
async function open(target: Element) {
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      }),
    ),
  );
}
async function copied(type: string): Promise<string> {
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  const blob = await write.mock.calls[0][0][0].getType(type);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}
it('copies a full rendered formula as LaTeX and clean HTML while refusing unsafe cut', async () => {
  const source = '# 顶\n\n公式 $x+1$ 后\n\n尾段';
  const { view } = await mount(source);
  const formula = host.querySelector('.katex-html')!;
  select(formula);
  await open(formula);
  expect(item('复制').disabled).toBe(false);
  expect(item('剪切').disabled).toBe(true);
  await act(async () => item('复制').click());
  expect(await copied('text/plain')).toBe('$x+1$');
  expect(await copied('text/html')).toContain('application/x-tex');
  expect(view.state.doc.toString()).toBe(source);
});
it('copies a partial formula selection as its actual visible characters', async () => {
  await mount('公式 $x+1$ 后\n\n尾段');
  const x = [...host.querySelectorAll('.katex-html .mord')].find(
    (element) => element.textContent === 'x',
  )!;
  select(x.firstChild!, 0, 1);
  await open(x);
  expect(item('复制').disabled).toBe(false);
  await act(async () => item('复制').click());
  expect(await copied('text/plain')).toBe('x');
  expect(await copied('text/html')).toBe('<span>x</span>');
});
it('exports ordinary Markdown and HTML without code buttons, line numbers or input controls', () => {
  const result = markdownCopy(
    '# 标题\n\n- [x] 完成\n\n| A | B |\n| --- | --- |\n| 甲 | 1 |\n\n```js\nconst x=1;\n```',
  );
  expect(result.html).toContain('<table>');
  const rendered = document.createElement('div');
  rendered.innerHTML = result.html;
  expect(rendered.textContent).toContain('const x=1;');
  expect(result.html).not.toMatch(/复制代码|代码语言|<button|<input|code-line-number|data-code/);
  expect(result.markdown).toContain('- [x] 完成');
});
it('uses both formats for a keyboard Copy of a source selection', async () => {
  const { view } = await mount('前 **格式** 后', 'source');
  await act(async () => view.dispatch({ selection: { anchor: 2, head: 8 } }));
  await act(async () =>
    view.contentDOM.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true })),
  );
  expect(await copied('text/plain')).toBe('**格式**');
  expect(await copied('text/html')).toContain('<strong>格式</strong>');
});
it('does not remove source when a keyboard Cut cannot write the clipboard', async () => {
  write.mockRejectedValue(Error('生成剪贴板拒绝'));
  const { view, error } = await mount('甲乙丙', 'source');
  await act(async () => view.dispatch({ selection: { anchor: 1, head: 2 } }));
  await act(async () =>
    view.contentDOM.dispatchEvent(new Event('cut', { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() =>
    expect(error).toHaveBeenCalledWith(expect.stringContaining('生成剪贴板拒绝')),
  );
  expect(view.state.doc.toString()).toBe('甲乙丙');
});
