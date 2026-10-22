// @vitest-environment jsdom
import { act, createRef } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { startCompletion, acceptCompletion, nextSnippetField } from '@codemirror/autocomplete';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle, MarkdownEditorProps } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';

let root: Root;
let host: HTMLDivElement;
let styles: HTMLStyleElement;
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
  styles = document.createElement('style');
  styles.textContent = readFileSync('src/editor/editor.css', 'utf8');
  document.head.append(styles);
  document.body.append(host);
  root = createRoot(host);
  reference = createRef<MarkdownEditorHandle>();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  styles.remove();
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
  it.each([
    { key: 'Home', selected: 'const value', anchor: 11, head: 0 },
    { key: 'End', selected: 'value = 1;', anchor: 6, head: 16 },
  ])(
    'extends an undirectional word selection with Shift+$key without dropping the selected word',
    async ({ key, selected, anchor, head }) => {
      const code = 'const value = 1;';
      const source = `\`\`\`javascript\n${code}\n\`\`\``;
      const offset = source.indexOf(code);
      const settings = { ...defaultSettings, codeWrap: false };
      const { onChange } = await mount({ value: source, settings });
      await act(async () => {
        editor().dispatch({
          selection: EditorSelection.create([
            EditorSelection.undirectionalRange(offset + 6, offset + 11),
          ]),
        });
        editor().contentDOM.dispatchEvent(
          new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true }),
        );
      });
      const range = editor().state.selection.main;
      expect(editor().state.sliceDoc(range.from, range.to)).toBe(selected);
      expect(range.anchor).toBe(offset + anchor);
      expect(range.head).toBe(offset + head);
      expect(editor().state.doc.toString()).toBe(source);
      expect(onChange).not.toHaveBeenCalled();
    },
  );
  it('keeps live prose wrapped and scrolls only the active code block when code wrapping is disabled', async () => {
    const paragraph = '这是应始终换行的正文。'.repeat(50);
    const longCode = `const text = "${'abcdef'.repeat(100)}";`;
    const source = `${paragraph}\n\n\`\`\`javascript\n${longCode}\nsecondLine();\n\`\`\`\n\n结尾`;
    const settings = structuredClone(defaultSettings);
    settings.codeWrap = false;
    const { props, onChange } = await mount({ value: source, settings });
    expect(editor().contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    expect(getComputedStyle(editor().contentDOM).minWidth).toBe('0px');
    expect(host.querySelector('.code-body.code-wrap')).toBeNull();
    expect(host.querySelector('.code-body')).not.toBeNull();
    const head = source.indexOf(longCode) + longCode.length;
    await act(async () => editor().dispatch({ selection: { anchor: head } }));
    const block = host.querySelector<HTMLElement>('.cm-code-source-block');
    expect(block).not.toBeNull();
    expect(block?.querySelectorAll('.cm-code-source')).toHaveLength(4);
    expect(block?.textContent).toContain(longCode);
    expect(host.querySelector('.cm-lineWrapping')).not.toBeNull();
    await act(async () => {
      editor().dispatch({ selection: { anchor: source.indexOf(longCode) + 3 } });
      editor().contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      );
    });
    expect(editor().state.selection.main.head).toBe(head);
    await act(async () => {
      editor().contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', shiftKey: true, bubbles: true }),
      );
    });
    expect(
      editor().state.sliceDoc(editor().state.selection.main.from, editor().state.selection.main.to),
    ).toBe(longCode);
    await act(async () => editor().dispatch({ selection: { anchor: head } }));
    if (!block) throw new Error('Missing code block scroller');
    expect(getComputedStyle(block).overflowX).toBe('auto');
    expect(getComputedStyle(block).maxWidth).toBe('100%');
    const codeLine = block.querySelector('.cm-line');
    expect(codeLine && getComputedStyle(codeLine).whiteSpace).toBe('pre');
    const measure = vi.spyOn(editor(), 'requestMeasure');
    block.dispatchEvent(new Event('scroll'));
    expect(measure).toHaveBeenCalled();
    Object.defineProperty(block, 'clientWidth', { configurable: true, value: 300 });
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 300, 80));
    const cursor = vi.spyOn(editor(), 'coordsAtPos').mockReturnValue(new DOMRect(700, 65, 1, 20));
    for (const handler of editor().state.facet(EditorView.scrollHandler))
      handler(editor(), editor().state.selection.main, {
        x: 'nearest',
        y: 'nearest',
        xMargin: 5,
        yMargin: 5,
      });
    expect(cursor).not.toHaveBeenCalled();
    const request = measure.mock.calls.at(-1)?.[0];
    if (!request?.read || !request.write) throw new Error('Missing code cursor measure');
    const measured = request.read(editor());
    request.write(measured, editor());
    expect(block.scrollLeft).toBeGreaterThan(0);
    expect(editor().scrollDOM.scrollLeft).toBe(0);
    expect(editor().state.selection.main.head).toBe(head);
    expect(editor().state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => reference.current?.insert(' // edited'));
    const edited = source.slice(0, head) + ' // edited' + source.slice(head);
    expect(editor().state.doc.toString()).toBe(edited);
    await act(async () =>
      root.render(
        <MarkdownEditor
          {...props}
          value={edited}
          settings={{ ...settings, codeWrap: true }}
          ref={reference}
        />,
      ),
    );
    expect(host.querySelector('.cm-code-source-block')).toBeNull();
    expect(editor().contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    await act(async () =>
      root.render(<MarkdownEditor {...props} value={edited} mode="source" ref={reference} />),
    );
    expect(host.querySelector('.cm-code-source-block')).toBeNull();
    expect(editor().contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
    expect(editor().state.doc.toString()).toBe(edited);
  });
  it('keeps live heading typography while revealing editable markers and restores plain source typography', async () => {
    const source = '# 一级标题\n\n## 二级标题\n\n正文';
    const { props, onChange } = await mount({ value: source });
    const activeHeading = host.querySelector('.cm-line.cm-heading-source-1');
    const renderedHeading = host.querySelector('h2');
    const renderedSize = renderedHeading && getComputedStyle(renderedHeading).fontSize;
    expect(activeHeading?.textContent).toBe('# 一级标题');
    expect(activeHeading && getComputedStyle(activeHeading).fontSize).toBe('2em');
    expect(activeHeading && getComputedStyle(activeHeading).fontWeight).toBe('650');
    expect(activeHeading && getComputedStyle(activeHeading).lineHeight).toBe('1.45');
    await act(async () => editor().dispatch({ selection: { anchor: source.indexOf('二级') } }));
    const nextHeading = host.querySelector('.cm-line.cm-heading-source-2');
    expect(nextHeading?.textContent).toBe('## 二级标题');
    expect(nextHeading && getComputedStyle(nextHeading).fontSize).toBe(renderedSize);
    expect(editor().state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.render(<MarkdownEditor {...props} mode="source" ref={reference} />));
    expect(host.querySelector('[class*="cm-heading-source"]')).toBeNull();
    expect(host.querySelectorAll('.cm-line')[0]?.textContent).toBe('# 一级标题');
    expect(editor().state.doc.toString()).toBe(source);
  });
  it('copies exact code whitespace while keeping the Fluent copy affordance intact', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await mount({ value: '# 代码\n\n```text\n  保留缩进\n\n```' });
    const button = host.querySelector<HTMLButtonElement>('.code-copy');
    await act(async () => button?.click());
    expect(writeText).toHaveBeenCalledWith('  保留缩进\n\n');
    expect(button?.querySelector('svg')).not.toBeNull();
    expect(button?.textContent).toBe('已复制');
    Reflect.deleteProperty(navigator, 'clipboard');
  });
  it('keeps table tools available during edits and returns focus inside the edited grid', async () => {
    const source = '# 表格\n\n| A | B |\n| --- | --- |\n| 一 | 二 |';
    await mount({ value: source });
    const cell = host.querySelector<HTMLInputElement>('[aria-label="表格第 2 行第 2 列"]');
    await act(async () => cell?.focus());
    const addColumn = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
    ).find((button) => button.textContent === '+ 列');
    await act(async () => addColumn?.click());
    expect(document.activeElement?.closest('.markdown-table-widget')).not.toBeNull();
    expect(host.querySelector('[aria-label="表格第 2 行第 3 列"]')).not.toBeNull();
    expect(editor().state.doc.toString()).toBe(
      '# 表格\n\n| A | B |  |\n| --- | --- | --- |\n| 一 | 二 |  |',
    );
    const outside = document.createElement('button');
    document.body.append(outside);
    await act(async () => outside.focus());
    expect(document.activeElement).toBe(outside);
    expect(
      host
        .querySelector('.table-toolbar')
        ?.parentElement?.classList.contains('markdown-table-widget'),
    ).toBe(true);
    outside.remove();
  });

  it('places formula preview inside CodeMirror below its source and reports local syntax errors', async () => {
    const source = '# 数学\n\n$$\n\\frac{a}{b}\n$$\n\n后面的段落';
    const { props } = await mount({
      value: source,
      mode: 'source',
      initialCursor: source.indexOf('a}'),
    });
    const preview = host.querySelector('.math-preview');
    expect(preview?.parentElement?.classList.contains('cm-content')).toBe(true);
    expect(preview?.previousElementSibling?.textContent).toContain('$$');
    expect(preview?.nextElementSibling?.textContent).not.toContain('\\frac');
    expect(editor().state.doc.toString()).toBe(source);
    const position = editor().state.selection.main.head;
    await act(async () => root.render(<MarkdownEditor {...props} mode="live" ref={reference} />));
    expect(editor().state.selection.main.head).toBe(position);
    expect(host.querySelector('.math-preview .katex')).not.toBeNull();
    await act(async () =>
      editor().dispatch({ selection: { anchor: source.indexOf('后面的段落') } }),
    );
    expect(host.querySelector('.math-preview')).toBeNull();
    const invalid = '$\\frac{$';
    await act(async () =>
      root.render(<MarkdownEditor {...props} value={invalid} mode="source" ref={reference} />),
    );
    await act(async () => editor().dispatch({ selection: { anchor: 4 } }));
    expect(host.querySelector('.math-preview-error')?.textContent).toContain('KaTeX parse error');
    expect(editor().state.doc.toString()).toBe(invalid);
  });
  it('keeps language, copy and folding in the same code header and preserves source on presentation changes', async () => {
    const source = '# 标题\n\n```javascript\nconst message = "中文";\n```';
    const settings = structuredClone(defaultSettings);
    settings.appearance.codeFontSize = 20;
    settings.appearance.codeLineHeight = 1.8;
    const { props } = await mount({ value: source, settings });
    const language = host.querySelector<HTMLInputElement>(
      '.code-caption input[aria-label="代码语言"]',
    );
    expect(language?.value).toBe('javascript');
    expect(host.querySelector('.code-caption .code-copy')).not.toBeNull();
    expect(
      host
        .querySelector<HTMLElement>('.code-container')
        ?.style.getPropertyValue('--code-font-size'),
    ).toBe('20px');
    const summary = host.querySelector<HTMLElement>('summary.code-caption');
    await act(async () => summary?.click());
    expect(host.querySelector('details')?.open).toBe(false);
    expect(editor().state.doc.toString()).toBe(source);
    await act(async () => summary?.click());
    await act(async () => {
      if (language) {
        language.value = 'typescript';
        language.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(editor().state.doc.toString()).toBe(source.replace('```javascript', '```typescript'));
    const latest = editor().state.doc.toString();
    await act(async () =>
      root.render(
        <MarkdownEditor
          {...props}
          value={latest}
          settings={{ ...settings, codeFold: false }}
          ref={reference}
        />,
      ),
    );
    expect(host.querySelector('details')).toBeNull();
    expect(host.querySelector('.code-caption input[aria-label="代码语言"]')).not.toBeNull();
    expect(editor().state.doc.toString()).toBe(latest);
  });
  it('does not reconfigure CodeMirror or rebuild previews while only sidebar width changes', async () => {
    const { props } = await mount();
    const view = editor();
    const preview = host.querySelector('.markdown-preview-block');
    const update = vi.spyOn(view, 'update');
    for (let index = 0; index < 56; index++) {
      const settings = structuredClone(defaultSettings);
      settings.leftWidth = 200 + index;
      settings.rightWidth = 300 - index;
      await act(async () =>
        root.render(<MarkdownEditor {...props} settings={settings} ref={reference} />),
      );
    }
    expect(
      update.mock.calls
        .flatMap(([transactions]) => transactions)
        .filter((transaction) => transaction.reconfigured),
    ).toHaveLength(0);
    expect(host.querySelector('.markdown-preview-block')).toBe(preview);
    expect(editor()).toBe(view);
    expect(editor().state.doc.toString()).toBe(props.value);
    const settings = structuredClone(defaultSettings);
    settings.codeWrap = !settings.codeWrap;
    await act(async () =>
      root.render(<MarkdownEditor {...props} settings={settings} ref={reference} />),
    );
    expect(
      update.mock.calls
        .flatMap(([transactions]) => transactions)
        .some((transaction) => transaction.reconfigured),
    ).toBe(true);
  });
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
