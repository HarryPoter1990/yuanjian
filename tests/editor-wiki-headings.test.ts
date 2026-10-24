// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractHeadings, extractLinks } from '../src/shared/markdown';
import { createMarkdownParser, renderMarkdown } from '../src/editor/renderer';

describe('wiki heading and source identities', () => {
  it.each([
    '# [[目标|别名]]',
    '# [[目标]]\n\n# [[别处|目标]]',
    '# **[[目标|别名]]** 与 `[[字面|代码]]`',
  ])(
    'uses identical visible heading text and unique IDs in the model and renderer: %s',
    (source) => {
      const host = document.createElement('div');
      host.innerHTML = renderMarkdown(source);
      expect(
        [...host.querySelectorAll('h1')].map((heading) => ({
          text: heading.textContent,
          id: heading.id,
        })),
      ).toEqual(extractHeadings(source).map(({ text, id }) => ({ text, id })));
    },
  );
  it('keeps a formula and wiki heading anchor identical across model and rendering', () => {
    const source = '# 公式 $x$ 与 [[目标|别名]]';
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown(source);
    expect(host.querySelector('h1')?.id).toBe(extractHeadings(source)[0].id);
    expect(extractHeadings(source)[0].text).toContain('别名');
  });
  it('retains source positions on actual wiki tokens without treating inline code as a link', () => {
    const source = '前 [[目标|别名]] 与 `[[字面|代码]]` 后';
    const tokens = createMarkdownParser().parseInline(source, {})[0].children!;
    const link = tokens.find((token) => token.type === 'link_open')!;
    expect(link.meta.sourceRange).toEqual({ from: 2, to: 11, contentFrom: 7, contentTo: 9 });
    expect(tokens.filter((token) => token.type === 'link_open')).toHaveLength(1);
    expect(source.slice(link.meta.sourceRange.contentFrom, link.meta.sourceRange.contentTo)).toBe(
      '别名',
    );
  });
  it('preserves image and note extraction for existing wiki syntax', () => {
    expect(
      extractLinks('![[图片.png]] [[另一篇#标题|别名]] `[[代码]]`').map(({ target, image }) => ({
        target,
        image,
      })),
    ).toEqual([
      { target: '图片.png', image: true },
      { target: '另一篇#标题', image: false },
    ]);
  });
});
