// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DocumentPreview, type DocumentPreviewHandle } from '../src/components/DocumentPreview';
import { renderReadingMarkdown } from '../src/editor/renderer';
import { defaultSettings } from '../src/shared/defaults';
import { asTab, appearanceColors } from '../src/ui/model';
import { paletteAppearance } from '../src/shared/palettes';
import { settingsSchema } from '../electron/validation';
let root: Root, host: HTMLDivElement;
const onLink = vi.fn(),
  onError = vi.fn(),
  asset = vi.fn(async () => 'note-asset://generated/picture.png');
const note = (path: string, content: string) =>
  asTab({ id: path, path, title: 'Generated', content, hash: 'generated', modifiedAt: 1 });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onLink.mockReset();
  onError.mockReset();
  asset.mockClear();
  window.notes = { assetUrl: asset } as unknown as typeof window.notes;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function show(path: string, content: string) {
  await act(async () =>
    root.render(
      <DocumentPreview
        note={note(path, content)}
        settings={defaultSettings}
        onLink={onLink}
        onError={onError}
      />,
    ),
  );
}
it('uses neutral defaults and validates them without reinterpreting an existing saved moss appearance', () => {
  const parsed = settingsSchema.parse(defaultSettings);
  expect(parsed.appearance.palette).toBe('neutral');
  for (const dark of [false, true]) {
    const c = appearanceColors({ ...parsed.appearance, mode: 'system' }, dark);
    for (const value of [c.background, c.sidebar, c.foreground, c.surface])
      expect(value.slice(1, 3)).toBe(value.slice(3, 5));
  }
  const old = paletteAppearance(defaultSettings.appearance, 'moss');
  const preserved = settingsSchema.parse({
    ...defaultSettings,
    appearance: { ...old, wallpaper: 'generated-existing.png', bodyFont: 'Chosen font' },
  });
  expect(preserved.appearance).toMatchObject({
    palette: 'moss',
    accent: '#526B57',
    wallpaper: 'generated-existing.png',
    bodyFont: 'Chosen font',
  });
});
it('resolves identical relative images against the current note path and discards pending renders on a fast tab switch', async () => {
  await show('D:/generated/A/a.md', '![图](picture.png)');
  await act(async () => vi.advanceTimersByTimeAsync(120));
  expect(asset).toHaveBeenLastCalledWith('picture.png', 'D:/generated/A/a.md');
  await show('D:/generated/B/b.md', '![图](picture.png)');
  expect(host.textContent).toContain('正在排版');
  await act(async () => vi.advanceTimersByTimeAsync(120));
  expect(asset).toHaveBeenLastCalledWith('picture.png', 'D:/generated/B/b.md');
  await show('D:/generated/C/c.md', '过期内容');
  await show('D:/generated/D/d.md', '最新内容');
  await act(async () => vi.advanceTimersByTimeAsync(120));
  expect(host.textContent).toContain('最新内容');
  expect(host.textContent).not.toContain('过期内容');
});
it('renders tables and formulas safely and delegates real links while local footnotes remain in the preview', async () => {
  await show(
    'D:/generated/note.md',
    '# 标题\n\n$E=mc^2$\n\n| 名称 | 结果 |\n| --- | --- |\n| 条件概率 | 还需练习 |\n\n正文[^1] [网站](https://example.org)\n\n[^1]: 解释内容\n\n<script>alert(1)</script>',
  );
  await act(async () => vi.advanceTimersByTimeAsync(120));
  expect(host.querySelector('table')?.textContent).toContain('条件概率');
  expect(host.querySelector('.katex')).not.toBeNull();
  expect(host.querySelector('script')).toBeNull();
  const footnote = host.querySelector<HTMLAnchorElement>('.footnote-ref a')!;
  const target = document.getElementById(decodeURIComponent(footnote.hash.slice(1)))!;
  target.scrollIntoView = vi.fn();
  await act(async () => footnote.click());
  expect(target.scrollIntoView).toHaveBeenCalled();
  expect(onLink).not.toHaveBeenCalled();
  await act(async () =>
    host.querySelector<HTMLAnchorElement>('a[href="https://example.org"]')!.click(),
  );
  expect(onLink).toHaveBeenCalledWith('https://example.org');
  expect(onError).not.toHaveBeenCalled();
});

it('maps reading blocks to original source lines, including CRLF properties, code, tables and formulas', () => {
  host.innerHTML = renderReadingMarkdown(
    '---\r\ntags: [学习]\r\n---\r\n# 标题\r\n\r\n正文\r\n\r\n```java\r\nint x = 1;\r\n```\r\n\r\n$$x^2$$\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 一 | 二 |',
  );
  expect(host.querySelector('h1')?.getAttribute('data-source-line')).toBe('4');
  expect(host.querySelector('p')?.getAttribute('data-source-line')).toBe('6');
  expect(host.querySelector('[data-source-line="8"] code')?.textContent).toContain('int x');
  expect(host.querySelector('.math-block')?.getAttribute('data-source-line')).toBe('12');
  expect(host.querySelector('[data-source-line="14"] table')).not.toBeNull();
});

it('queues a reading jump until rendering is ready and restores a block offset without changing source', async () => {
  const handle = createRef<DocumentPreviewHandle>();
  const positions = vi.fn();
  const content = '# 开头\n\n第一段\n\n## 目标\n\n末段';
  const geometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const top = this === host ? 0 : Number(this.dataset.sourceLine ?? 0) * 100 - host.scrollTop;
      return {
        top,
        bottom: top + 40,
        left: 0,
        right: 600,
        width: 600,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });
  await act(async () =>
    root.render(
      <DocumentPreview
        ref={handle}
        note={note('D:/generated/jump.md', content)}
        settings={defaultSettings}
        onLink={onLink}
        onError={onError}
        onPosition={positions}
      />,
    ),
  );
  handle.current!.scrollToLine(5);
  await act(async () => vi.advanceTimersByTimeAsync(120));
  expect(host.scrollTop).toBe(476);
  const cursor = content.indexOf('## 目标');
  handle.current!.restorePosition(cursor, 0, { from: cursor, offset: -12, left: 0 });
  expect(host.scrollTop).toBe(512);
  expect(handle.current!.getPosition()).toMatchObject({
    cursor,
    scrollTop: 512,
    scrollAnchor: { from: cursor, offset: -12 },
  });
  expect(positions).toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  geometry.mockRestore();
});
