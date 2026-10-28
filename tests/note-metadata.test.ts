import { expect, it } from 'vitest';
import { extractHeadings, extractLinks, extractTags } from '../src/shared/markdown';

it('omits headings, links and tags inside note comments', () => {
  const source = '# 标题\n\n%%\n# 隐藏标题\n\n[[隐藏笔记]] #隐藏标签\n%%\n\n可见内容 #学习';
  expect(extractHeadings(source).map((h) => h.text)).toEqual(['标题']);
  expect(extractLinks(source)).toEqual([]);
  expect(extractTags(source)).toEqual(['学习']);
});
it('keeps heading labels and block-reserved anchors consistent with reading', () => {
  const source = '# ==学习== H~2~O\n\n# block-home\n\n正文。 ^home';
  expect(extractHeadings(source).map((h) => h.text)).toEqual(['学习 H2O', 'block-home']);
  expect(extractHeadings(source)[1].id).not.toBe('block-home');
});
it('distinguishes embedded notes from images without losing the original target', () => {
  const links = extractLinks('![[另一篇#^定义]]\n\n![[图.png|200]]\n\n[[#^home|回来]]');
  expect(links).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ target: '另一篇#^定义', image: false, embedded: true }),
      expect.objectContaining({ target: '图.png', image: true, embedded: true }),
      expect.objectContaining({ target: '#^home', image: false }),
    ]),
  );
});
it('indexes headings inside details and ignores code/math syntax markers', () => {
  const source =
    '<details>\n<summary>补充</summary>\n\n## 内部标题\n\n</details>\n\n```md\n![[代码中的文字]]\n```\n\n$$\n\\text{#不应作为标签}\n$$';
  expect(extractHeadings(source).map((h) => h.text)).toEqual(['内部标题']);
  expect(extractLinks(source)).toEqual([]);
  expect(extractTags(source)).toEqual([]);
});
