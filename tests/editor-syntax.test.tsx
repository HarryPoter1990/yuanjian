// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import { selectedCopy } from '../src/editor/clipboard-output';

let host: HTMLDivElement, root: Root;
const ref = createRef<MarkdownEditorHandle>();
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
async function mount(body: string) {
  const source = body + '\n\n末尾';
  await act(async () =>
    root.render(
      <MarkdownEditor
        prototypeEditing
        ref={ref}
        value={source}
        initialCursor={source.length}
        mode="live"
        settings={defaultSettings}
        onChange={() => {}}
        resolveAssetAsync={async () => 'data:image/png;base64,aA=='}
      />,
    ),
  );
  expect(ref.current!.getView()!.state.doc.toString()).toBe(source);
  return ref.current!.getView()!;
}
it('renders Setext headings without exposing the underline until editing', async () => {
  const view = await mount('学习笔记\n====');
  expect(host.querySelector('.cm-heading-source-1')?.textContent).toBe('学习笔记');
  expect(host.querySelector('.cm-content')?.textContent).not.toContain('====');
  await act(async () => view.dispatch({ selection: { anchor: 2 } }));
  expect(host.querySelector('.cm-content')?.textContent).toContain('====');
});
it.each(['![示例](photo.png "图片说明")', '![示例][图]\n\n[图]: photo.png "图片说明"'])(
  'renders standard image %s and reveals its local source on entry',
  async (source) => {
    const view = await mount(source);
    const image = host.querySelector<HTMLImageElement>('img[data-asset-src]');
    expect(image?.alt).toBe('示例');
    expect(image?.title).toBe('图片说明');
    await act(async () => view.dispatch({ selection: { anchor: 3 } }));
    expect(host.querySelector('.cm-content')?.textContent).toContain('![示例]');
  },
);
it.each(['<https://example.com>', 'https://example.com', '<study@example.com>'])(
  'gives automatic links a target: %s',
  async (source) => {
    await mount(source);
    expect(host.querySelector('[data-link-target]')?.getAttribute('data-link-target')).toMatch(
      /example\.com/,
    );
  },
);
it('renders and toggles a task nested inside a quote', async () => {
  const view = await mount('> - [ ] 整理笔记');
  const checkbox = host.querySelector<HTMLInputElement>('input[type=checkbox]');
  expect(checkbox).not.toBeNull();
  await act(async () => checkbox!.click());
  expect(view.state.doc.toString()).toContain('> - [x] 整理笔记');
});
it('renders a footnote reference while retaining its source for editing', async () => {
  const view = await mount('正文[^注]\n\n[^注]: 补充说明');
  expect(host.querySelector('sup[data-footnote-ref="注"] a')).not.toBeNull();
  await act(async () => view.dispatch({ selection: { anchor: 4 } }));
  expect(host.querySelector('.cm-content')?.textContent).toContain('[^注]');
});
it('displays escaped markers and entities without changing source', async () => {
  await mount('\\*星号\\* 与 A &amp; B');
  expect(host.querySelector('.cm-content')?.textContent).toContain('*星号* 与 A & B');
  expect(host.querySelector('.cm-content')?.textContent).not.toContain('\\');
});
it('locally reveals highlight and super/subscript markers', async () => {
  const view = await mount('==重点==，H~2~O，x^2^');
  expect(host.querySelector('.prototype-highlight')?.textContent).toBe('重点');
  expect(host.querySelector('.prototype-sub')?.textContent).toBe('2');
  expect(host.querySelector('.prototype-sup')?.textContent).toBe('2');
  await act(async () => view.dispatch({ selection: { anchor: 3 } }));
  expect(host.querySelector('.prototype-highlight')?.textContent).toBe('==重点==');
  expect(host.querySelector('.prototype-sub')?.textContent).toBe('2');
});
it('hides multiline comments until the caret enters them', async () => {
  const view = await mount('正文 %%内部\n\n注释%% 继续');
  expect(host.querySelector('.cm-content')?.textContent).not.toContain('内部');
  await act(async () => view.dispatch({ selection: { anchor: 7 } }));
  expect(host.querySelector('.prototype-comment')?.textContent).toContain('内部');
});
it('folds nested callouts without changing source and expands on caret entry', async () => {
  const source = '> [!info]- 提示\n> 隐藏正文\n>\n> > [!tip]+ 子提示\n> > 子正文';
  const view = await mount(source);
  expect(host.querySelector('.cm-content')?.textContent).not.toContain('隐藏正文');
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="展开提示块"]');
  expect(toggle).not.toBeNull();
  await act(async () => toggle!.click());
  expect(host.querySelector('.cm-content')?.textContent).toContain('隐藏正文');
  expect(view.state.doc.toString()).toBe(source + '\n\n末尾');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="折叠提示块"]')!.click(),
  );
  await act(async () => view.dispatch({ selection: { anchor: source.indexOf('隐藏正文') + 1 } }));
  expect(host.querySelector('.cm-content')?.textContent).toContain('隐藏正文');
});
it('renders a live TOC and updates it after a heading change', async () => {
  const view = await mount('[TOC]\n\n# 学习');
  expect(host.querySelector('.note-toc a')?.textContent).toBe('学习');
  await act(async () => view.dispatch({ changes: { from: 9, to: 11, insert: '复习' } }));
  expect(host.querySelector('.note-toc a')?.textContent).toBe('复习');
});
it('copies prototype syntax as original Markdown and rendered HTML without hidden comments', async () => {
  const body = '> [!info]- 标题\n> ==正文==\n\n%%内部注释%%';
  const view = await mount(body);
  await act(async () => view.dispatch({ selection: { anchor: 0, head: body.length } }));
  const copy = selectedCopy(view)!;
  expect(copy.markdown).toBe(body);
  const rendered = document.createElement('div');
  rendered.innerHTML = copy.html;
  expect(rendered.querySelector('summary')?.textContent).toContain('标题');
  expect(rendered.querySelector('mark')?.textContent).toBe('正文');
  expect(rendered.textContent).not.toContain('内部注释');
});
it('previews fenced code and tables nested in callouts without exposing surrounding source', async () => {
  await mount(
    '> [!info] 示例\n>\n> ```java\n> int value = 1;\n> ```\n>\n> | 项目 | 说明 |\n> | --- | --- |\n> | 输入 | 文字 |',
  );
  expect(host.querySelector('.code-container code')?.textContent).toContain('int value = 1;');
  expect(host.querySelector('table')?.textContent).toContain('输入');
});
it('uses parsed ordered-list numbering outside the edited line', async () => {
  await mount('1. 第一项\n1. 第二项\n1. 第三项');
  expect([...host.querySelectorAll('.prototype-list-prefix')].map((e) => e.textContent)).toEqual([
    '1.',
    '2.',
    '3.',
  ]);
});
it('keeps complex nested previews hidden when their callout is folded', async () => {
  await mount('> [!info]- 折叠\n>\n> ```js\n> const hidden = true;\n> ```');
  expect(host.querySelector('.code-container')).toBeNull();
});
