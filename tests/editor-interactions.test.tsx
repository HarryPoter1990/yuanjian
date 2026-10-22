// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { startCompletion, acceptCompletion, nextSnippetField } from '@codemirror/autocomplete';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle, MarkdownEditorProps } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';

let root: Root;
let host: HTMLDivElement;
let reference = createRef<MarkdownEditorHandle>();

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
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function mount(
  overrides: Partial<MarkdownEditorProps> = {},
): Promise<{ onChange: ReturnType<typeof vi.fn>; props: MarkdownEditorProps }> {
  const onChange = vi.fn();
  const props: MarkdownEditorProps = {
    value: '# 测试\n\n普通 **原文**。\n\n尾段',
    settings: defaultSettings,
    mode: 'live',
    onChange,
    ...overrides,
  };
  await act(async () => root.render(<MarkdownEditor {...props} ref={reference} />));
  return { onChange, props };
}

function editor(): EditorView {
  const view = reference.current?.getView();
  if (!view) throw new Error('Editor not mounted');
  return view;
}

describe('mounted CodeMirror editor', () => {
  it('reveals a clicked paragraph, edits Chinese source and supports undo and mode switches', async () => {
    const { props, onChange } = await mount();
    expect(host.querySelectorAll('.markdown-preview-block')).toHaveLength(2);
    const paragraph = Array.from(
      host.querySelectorAll<HTMLElement>('.markdown-preview-block'),
    ).find((element) => element.textContent?.includes('普通'));
    expect(paragraph).toBeDefined();
    await act(async () => paragraph?.click());
    expect(editor().state.doc.toString()).toBe(props.value);
    expect(editor().state.selection.main.head).toBeGreaterThanOrEqual(props.value.indexOf('普通'));
    await act(async () => reference.current?.insert('中文输入'));
    expect(onChange.mock.lastCall?.[0]).toContain('中文输入');
    await act(async () => reference.current?.command('undo'));
    expect(editor().state.doc.toString()).toBe(props.value);
    await act(async () => root.render(<MarkdownEditor {...props} mode="source" ref={reference} />));
    expect(host.querySelectorAll('.markdown-preview-block')).toHaveLength(0);
    expect(editor().state.doc.toString()).toBe(props.value);
    await act(async () => root.render(<MarkdownEditor {...props} mode="live" ref={reference} />));
    expect(host.querySelectorAll('.markdown-preview-block')).toHaveLength(2);
  });

  it('edits a grid cell, adds rows, aligns columns and undoes exact source changes', async () => {
    const value = '开头  不改\n\n| A | B |\n| --- | --- |\n| 一 | 二 |\n\n结尾  不改';
    await mount({ value });
    let input = host.querySelector<HTMLInputElement>('[aria-label="表格第 2 行第 2 列"]');
    if (!input) throw new Error('Missing cell');
    await act(async () => {
      input?.focus();
      if (input) input.value = '改为中文';
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.blur();
    });
    expect(editor().state.doc.toString()).toBe(value.replace('| 一 | 二 |', '| 一 | 改为中文 |'));
    const addRow = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.table-toolbar button'),
    ).find((button) => button.textContent === '+ 行');
    await act(async () => addRow?.click());
    expect(editor().state.doc.toString()).toContain('|  |  |');
    const align = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.table-toolbar button'),
    ).find((button) => button.textContent === '居中');
    await act(async () => align?.click());
    expect(editor().state.doc.toString()).toContain(':---:');
    expect(editor().state.doc.toString().startsWith('开头  不改\n\n')).toBe(true);
    expect(editor().state.doc.toString().endsWith('\n\n结尾  不改')).toBe(true);
    await act(async () => reference.current?.command('undo'));
    expect(editor().state.doc.toString()).not.toContain(':---:');
  });

  it('maps clicks in formatted text back to the corresponding original source position', async () => {
    const value = '文首\n\n普通 **原文**。';
    await mount({ value });
    const strong = host.querySelector('strong');
    if (!strong?.firstChild) throw new Error('Expected bold preview');
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: strong.firstChild, offset: 1 }),
    });
    await act(async () => strong.click());
    expect(editor().state.selection.main.head).toBe(value.indexOf('原文') + 1);
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
  });

  it('inserts formula snippets and moves through real CodeMirror parameter selections', async () => {
    await mount({ value: '$frac$', mode: 'source', initialCursor: 5 });
    await act(async () => {
      editor().focus();
      startCompletion(editor());
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await act(async () => {
      expect(acceptCompletion(editor())).toBe(true);
    });
    expect(editor().state.doc.toString()).toBe('$\\frac{分子}{分母}$');
    expect(
      editor().state.sliceDoc(editor().state.selection.main.from, editor().state.selection.main.to),
    ).toBe('分子');
    await act(async () => {
      expect(nextSnippetField(editor())).toBe(true);
    });
    expect(
      editor().state.sliceDoc(editor().state.selection.main.from, editor().state.selection.main.to),
    ).toBe('分母');
    expect(host.querySelector('.math-preview .katex')).not.toBeNull();
  });

  it('keeps unchanged preview DOM and table handlers correct when earlier source shifts', async () => {
    const value = '开始\n\n后面的 **段落**\n\n| A | B |\n| --- | --- |\n| 一 | 二 |';
    await mount({ value });
    const preview = host.querySelector('.markdown-preview-block');
    const grid = host.querySelector('.markdown-table-widget');
    await act(async () => reference.current?.insert('前面增加文字'));
    expect(host.querySelector('.markdown-preview-block')).toBe(preview);
    expect(host.querySelector('.markdown-table-widget')).toBe(grid);
    const input = host.querySelector<HTMLInputElement>('[aria-label="表格第 2 行第 1 列"]');
    await act(async () => {
      input?.focus();
      if (input) input.value = '新值';
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.blur();
    });
    expect(editor().state.doc.toString()).toContain('| 新值 | 二 |');
    expect(editor().state.doc.toString()).toContain('前面增加文字开始');
  });

  it('converts rich paste and routes links and async images through callbacks', async () => {
    const onLink = vi.fn();
    const onImage = vi.fn(async () => 'assets/粘贴图片.png');
    await mount({ onLink, onImage });
    const clipboard = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(clipboard, 'clipboardData', {
      value: {
        files: [],
        getData: (format: string) =>
          format === 'text/html' ? '<h2>富文本</h2><p><b>加粗</b></p>' : '富文本 加粗',
      },
    });
    await act(async () => {
      editor().contentDOM.dispatchEvent(clipboard);
    });
    expect(editor().state.doc.toString()).toContain('## 富文本\n\n**加粗**');
    await act(async () => reference.current?.insert('\n\n[目标](other.md)\n\n'));
    await act(async () => editor().dispatch({ selection: { anchor: 0 } }));
    const link = host.querySelector<HTMLAnchorElement>('a[href="other.md"]');
    await act(async () => link?.click());
    expect(onLink).toHaveBeenCalledWith('other.md');
    const imagePaste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(imagePaste, 'clipboardData', {
      value: {
        files: [new File(['image bytes'], '测试.png', { type: 'image/png' })],
        getData: () => '',
      },
    });
    await act(async () => {
      editor().contentDOM.dispatchEvent(imagePaste);
      await Promise.resolve();
    });
    expect(onImage).toHaveBeenCalledOnce();
    expect(editor().state.doc.toString()).toContain('![测试.png](assets/粘贴图片.png)');
  });
});
