// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import { createMarkdownParser, renderMarkdown } from '../src/editor/renderer';
import { extractHeadings } from '../src/shared/markdown';

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
async function mount(value: string, initialCursor = value.length) {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        value={value}
        onChange={onChange}
        mode="live"
        settings={defaultSettings}
        initialCursor={initialCursor}
        ref={ref}
      />,
    ),
  );
  return { view: ref.current!.getView()!, onChange };
}

describe('document context in live editing', () => {
  it.each([
    { body: '普通 **正文**', selector: 'strong', text: '正文' },
    { body: '# 普通标题', selector: 'h1', text: '普通标题' },
    { body: '- 普通列表', selector: 'li', text: '普通列表' },
  ])(
    'keeps a leading horizontal rule followed by $body as ordinary Markdown',
    async ({ body, selector, text }) => {
      const source = `---\n${body}\n\n尾段`;
      const { view, onChange } = await mount(source);
      expect(host.querySelector('[aria-label="YAML 属性错误"]')).toBeNull();
      expect(host.querySelector('.markdown-frontmatter')).toBeNull();
      expect(host.querySelector('hr')).not.toBeNull();
      expect(host.querySelector(selector)?.textContent).toBe(text);
      expect(view.state.doc.toString()).toBe(source);
      expect(onChange).not.toHaveBeenCalled();
    },
  );
  it('renders reference links using document definitions and refreshes a changed definition', async () => {
    const source = '[参考][guide]\n\n[guide]: https://example.com/one\n\n尾段';
    const { view, onChange } = await mount(source);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/one');
    expect(onChange).not.toHaveBeenCalled();
    const from = source.indexOf('/one');
    await act(async () => view.dispatch({ changes: { from, to: from + 4, insert: '/two' } }));
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/two');
    expect(view.state.doc.toString()).toBe(source.replace('/one', '/two'));
  });
  it('keeps two horizontal rules around an opening paragraph as ordinary Markdown', async () => {
    const source = '---\n\n开场 **段落**\n\n---\n\n# 合法标题\n\n尾段';
    const { view, onChange } = await mount(source);
    expect(host.querySelector('.markdown-frontmatter')).toBeNull();
    expect(host.querySelectorAll('hr')).toHaveLength(2);
    expect(host.querySelector('strong')?.textContent).toBe('段落');
    expect(host.querySelector('h1')?.textContent).toBe('合法标题');
    expect(view.state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('keeps duplicate heading IDs global without a permanent source-marker gutter', async () => {
    const source = '# 重复\n\n# 重复\n\n尾段';
    const { view, onChange } = await mount(source);
    expect([...host.querySelectorAll('h1')].map((h) => h.id)).toEqual(
      extractHeadings(source).map((h) => h.id),
    );
    expect(host.querySelector('.markdown-heading-prefix,.markdown-heading-suffix')).toBeNull();
    expect(host.querySelector('h1')?.textContent).toBe('重复');
    expect(view.state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('keeps global task source offsets correct after metadata and earlier lines shift', async () => {
    const source = '---\ntags: [学习]\n---\n\n# 标题\n\n- [ ] 任务\n\n尾段';
    const { view } = await mount(source);
    const checkbox = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    const from = source.indexOf('# 标题');
    await act(async () => view.dispatch({ changes: { from, insert: '前置段落\n\n' } }));
    expect(host.querySelector('input[type=checkbox]')).toBe(checkbox);
    await act(async () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(view.state.doc.toString()).toBe(
      (source.slice(0, from) + '前置段落\n\n' + source.slice(from)).replace(
        '- [ ] 任务',
        '- [x] 任务',
      ),
    );
  });
  it.each([0, 2, 4])(
    'closes inline math after %i backslashes consistently in reading output',
    (count) => {
      const content = 'x' + '\\'.repeat(count);
      const tokens = createMarkdownParser().parseInline(`$${content}$`, {})[0].children!;
      expect(tokens.some((t) => t.type === 'inline_math' && t.content === content)).toBe(true);
    },
  );
  it('keeps formula heading identities consistent between the model and full rendering', () => {
    const source = '# 公式 $x$';
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown(source);
    expect(root.querySelector('h1')?.id).toBe(extractHeadings(source)[0].id);
  });
  it('starts with compact YAML properties and reveals the exact raw source for editing', async () => {
    const source = '---\ntags: [学习]\ntitle: 属性标题\n---\n\n# 正文标题\n\n尾段';
    const { view, onChange } = await mount(source);
    const expand = host.querySelector<HTMLButtonElement>('[aria-label="展开原始 YAML 属性"]');
    expect(expand).not.toBeNull();
    expect(host.querySelector('.markdown-frontmatter')?.textContent).not.toContain('tags:');
    expect(host.querySelector('h2')?.textContent ?? '').not.toContain('tags:');
    await act(async () => expand!.click());
    expect(
      [...host.querySelectorAll('.cm-line')].some((line) => line.textContent === 'tags: [学习]'),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => view.dispatch({ selection: { anchor: source.length } }));
    expect(host.querySelector('[aria-label="展开原始 YAML 属性"]')).not.toBeNull();
  });
  it('keeps invalid YAML visible with an error and never rewrites its source', async () => {
    const source = '---\ntags: [未闭合\n---\n\n尾段';
    const { view, onChange } = await mount(source);
    expect(host.querySelector('[aria-label="YAML 属性错误"]')?.textContent).toMatch(/YAML|属性/);
    expect(
      [...host.querySelectorAll('.cm-line')].some((line) => line.textContent === 'tags: [未闭合'),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('keeps BOM and CRLF equivalence while editing and undoing raw expanded metadata', async () => {
    const source = '\uFEFF---\r\ntags: [学习]\r\n---\r\n\r\n尾段';
    const { view, onChange } = await mount(source, 0);
    const expand = host.querySelector<HTMLButtonElement>('[aria-label="展开原始 YAML 属性"]')!;
    expect(expand).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => expand.click());
    const from = view.state.doc.toString().indexOf('学习');
    await act(async () =>
      view.dispatch({ changes: { from, to: from + 2, insert: '复习' }, userEvent: 'input.type' }),
    );
    expect(view.state.doc.toString()).toBe(source.replace(/\r\n/g, '\n').replace('学习', '复习'));
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe(source.replace(/\r\n/g, '\n'));
  });
  it('preserves unclosed metadata and following prose visibly for recovery', async () => {
    const source = '---\ntags: [学习]\n\n正文仍在';
    const { view, onChange } = await mount(source);
    expect(host.querySelector('[aria-label="YAML 属性错误"]')?.textContent).toContain('结束分隔线');
    expect(host.textContent).toContain('正文仍在');
    expect(view.state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });
});
