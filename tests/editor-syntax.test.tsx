// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';

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
