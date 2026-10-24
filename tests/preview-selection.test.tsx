// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';

let host: HTMLDivElement;
let root: Root;
let reference = createRef<MarkdownEditorHandle>();
const originalCaretPoint = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint');
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
  reference = createRef<MarkdownEditorHandle>();
});
afterEach(async () => {
  getSelection()?.removeAllRanges();
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  if (originalCaretPoint)
    Object.defineProperty(document, 'caretPositionFromPoint', originalCaretPoint);
  else Reflect.deleteProperty(document, 'caretPositionFromPoint');
});
async function mount(source: string, mode: 'live' | 'source' = 'live') {
  const onChange = vi.fn();
  const onLink = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={reference}
        value={source}
        mode={mode}
        initialCursor={source.length}
        settings={defaultSettings}
        onChange={onChange}
        onLink={onLink}
      />,
    ),
  );
  const view = reference.current?.getView();
  if (!view) throw new Error('Missing editor');
  return { view, onChange, onLink };
}
function textContaining(element: Element, value: string): Text {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.textContent?.includes(value)) return node as Text;
  throw new Error(`Text not found: ${value}`);
}
function preview(value: string): HTMLElement {
  const block = [...host.querySelectorAll<HTMLElement>('.markdown-preview-block')].find((element) =>
    element.textContent?.includes(value),
  );
  if (!block) throw new Error(`Preview not found: ${value}`);
  return block;
}
describe('preview selection and heading prefixes', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'reveals H%i markers only while its source is active',
    async (level) => {
      const prefix = `${'#'.repeat(level)} `;
      const source = `${prefix}标题\n\n尾段`;
      const { view, onChange } = await mount(source);
      expect(host.querySelector('.markdown-heading-prefix,.markdown-heading-suffix')).toBeNull();
      expect(host.querySelector(`h${level}`)?.textContent).toBe('标题');
      await act(async () => view.dispatch({ selection: { anchor: 1 } }));
      expect(host.querySelector(`.cm-heading-source-${level}`)?.textContent).toBe(`${prefix}标题`);
      expect(view.state.doc.toString()).toBe(source);
      expect(onChange).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'retains a heading drag range and its reversed=%s direction',
    async (reversed) => {
      const source = '### 标题重复标题\n\n尾段';
      const { view, onChange } = await mount(source);
      const block = preview('标题重复标题');
      const text = textContaining(block, '标题重复标题');
      const anchor = reversed ? 5 : 1,
        head = reversed ? 1 : 5;
      getSelection()?.setBaseAndExtent(text, anchor, text, head);
      await act(async () => block.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(view.state.selection.main.anchor).toBe(4 + anchor);
      expect(view.state.selection.main.head).toBe(4 + head);
      expect(
        view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      ).toBe('题重复标');
      expect(view.state.doc.toString()).toBe(source);
      expect(onChange).not.toHaveBeenCalled();
    },
  );
  it('omits marker spacing in reading output without changing source', async () => {
    const source = '  ###   标题  ###  \n\n尾段';
    const { view } = await mount(source);
    expect(host.querySelector('.markdown-heading-prefix,.markdown-heading-suffix')).toBeNull();
    expect(host.querySelector('h3')?.textContent).toBe('标题');
    expect(view.state.doc.toString()).toBe(source);
  });
  it.each([false, true])(
    'maps a cross-block drag without sorting reversed=%s endpoints',
    async (reversed) => {
      const source = '### 标题内容\n\n第二段内容\n\n尾段';
      const { view } = await mount(source);
      const first = preview('标题内容'),
        second = preview('第二段内容');
      const a = textContaining(first, '标题内容'),
        b = textContaining(second, '第二段内容');
      getSelection()?.setBaseAndExtent(
        reversed ? b : a,
        reversed ? 3 : 1,
        reversed ? a : b,
        reversed ? 1 : 3,
      );
      await act(async () =>
        (reversed ? first : second).dispatchEvent(new MouseEvent('click', { bubbles: true })),
      );
      expect(view.state.selection.main.anchor).toBe(reversed ? source.indexOf('第二段') + 3 : 5);
      expect(view.state.selection.main.head).toBe(reversed ? 5 : source.indexOf('第二段') + 3);
    },
  );
  it.each([false, true])(
    'retains the original pointer anchor after a native focus reset, reversed=%s',
    async (reversed) => {
      const source = '### 标题重复标题\n\n尾段';
      const { view } = await mount(source);
      const block = preview('标题重复标题'),
        text = textContaining(block, '标题重复标题');
      const anchor = reversed ? 5 : 1,
        head = reversed ? 1 : 5;
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi
          .fn()
          .mockReturnValueOnce({ offsetNode: text, offset: anchor })
          .mockReturnValueOnce({ offsetNode: text, offset: head }),
      });
      await act(async () => {
        text.parentElement?.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 10 }),
        );
        getSelection()?.removeAllRanges();
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 50 }));
      });
      expect(view.state.selection.main.anchor).toBe(4 + anchor);
      expect(view.state.selection.main.head).toBe(4 + head);
      expect(view.state.doc.toString()).toBe(source);
    },
  );
  it('maps a rendered endpoint and an already editable source endpoint together', async () => {
    const source = '### 标题内容\n\n尾段正文';
    const { view } = await mount(source);
    const block = preview('标题内容'),
      first = textContaining(block, '标题内容');
    const lastLine = [...view.contentDOM.querySelectorAll('.cm-line')].find((element) =>
      element.textContent?.includes('尾段正文'),
    );
    if (!lastLine) throw new Error('Missing active source line');
    const last = textContaining(lastLine, '尾段正文');
    getSelection()?.setBaseAndExtent(first, 1, last, 2);
    await act(async () => block.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(view.state.selection.main.anchor).toBe(5);
    expect(view.state.selection.main.head).toBe(source.indexOf('尾段正文') + 2);
  });
  it.each(['blur', 'Escape', 'document change'])(
    'discards a pending pointer anchor after %s',
    async (reason) => {
      const source = '### 标题重复标题\n\n尾段';
      const { view } = await mount(source);
      const block = preview('标题重复标题'),
        text = textContaining(block, '标题重复标题');
      const point = vi
        .fn()
        .mockReturnValueOnce({ offsetNode: text, offset: 1 })
        .mockReturnValue({ offsetNode: text, offset: 5 });
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: point,
      });
      let before = view.state.selection.main;
      await act(async () => {
        text.parentElement?.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 10 }),
        );
        if (reason === 'blur') window.dispatchEvent(new Event('blur'));
        else if (reason === 'Escape')
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else view.dispatch({ changes: { from: view.state.doc.length, insert: 'changed' } });
        before = view.state.selection.main;
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 50 }));
      });
      expect(view.state.selection.main.eq(before)).toBe(true);
      expect(point).toHaveBeenCalledTimes(1);
    },
  );
  it('leaves an unmappable native drag range intact instead of collapsing it', async () => {
    const source = '前 <span>文字</span> 与正文\n\n尾段';
    const { view } = await mount(source);
    const block = preview('与正文'),
      text = textContaining(block, '与正文');
    getSelection()?.setBaseAndExtent(text, 1, text, 3);
    const before = view.state.selection.main.head;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => block.dispatchEvent(event));
    expect(getSelection()?.isCollapsed).toBe(false);
    expect(view.state.selection.main.head).toBe(before);
    expect(event.defaultPrevented).toBe(true);
  });
  it('keeps normal link and task controls interactive', async () => {
    const source = '[链接](https://example.com)\n\n- [ ] 任务\n\n尾段';
    const { onLink, view } = await mount(source);
    await act(async () =>
      host
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
    expect(onLink).toHaveBeenCalledWith('https://example.com');
    const checkbox = host.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (!checkbox) throw new Error('Missing checkbox');
    checkbox.checked = true;
    await act(async () => checkbox.dispatchEvent(new Event('change', { bubbles: true })));
    expect(view.state.doc.toString()).toContain('- [x] 任务');
  });
  it('keeps keyboard link activation working while another paragraph is selected', async () => {
    const source = '选择正文\n\n[链接](https://example.com)\n\n尾段';
    const { onLink } = await mount(source);
    const text = textContaining(preview('选择正文'), '选择正文');
    getSelection()?.setBaseAndExtent(text, 0, text, 3);
    const link = host.querySelector('a');
    if (!link) throw new Error('Missing link');
    link.focus();
    await act(async () =>
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })),
    );
    expect(onLink).toHaveBeenCalledWith('https://example.com');
  });
  it('does not add preview prefixes in source mode', async () => {
    const { view } = await mount('### 标题\n\n正文', 'source');
    expect(host.querySelector('.markdown-heading-prefix')).toBeNull();
    expect(host.querySelector('.cm-heading-source')).toBeNull();
    expect(view.state.doc.toString()).toBe('### 标题\n\n正文');
  });
});
