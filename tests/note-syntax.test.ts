// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderMarkdown, renderReadingMarkdown } from '../src/editor/renderer';

const options = { prototypeSyntax: true };
const html = (source: string) => {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(source, options);
  return root;
};
it('renders common callouts, aliases, custom titles and unknown types', () => {
  const root = html('> [!WARNING] 注意 **边界**\n> 正文\n\n> [!my-type]\n> 内容');
  expect(root.querySelector('[data-callout="warning"] strong')?.textContent).toBe('边界');
  expect(root.querySelector('[data-callout="my-type"]')).not.toBeNull();
  expect(root.textContent).not.toContain('[!');
  expect(root.textContent).toContain('正文');
});
it('preserves nested callouts and explicit fold defaults', () => {
  const root = html('> [!info]- 提示\n> 内容\n>\n> > [!tip]+ 建议\n> > 第二层');
  expect(root.querySelector('details[data-callout="info"]')?.hasAttribute('open')).toBe(false);
  expect(root.querySelector('details details[data-callout="tip"]')?.hasAttribute('open')).toBe(
    true,
  );
});
it('supports highlight, super/subscript without applying rules in code or math', () => {
  const root = html('==重点 **内容**==，H~2~O，x^2^。`==代码==` 和 $x^2$');
  expect(root.querySelector('mark strong')?.textContent).toBe('内容');
  expect(root.querySelector('sub')?.textContent).toBe('2');
  expect(root.querySelector('p > sup')?.textContent).toBe('2');
  expect(root.querySelector('code')?.textContent).toBe('==代码==');
  expect(root.querySelector('.katex')).not.toBeNull();
});
it('hides multiline comments and HTML comments but preserves literal code and math', () => {
  const root = html(
    '前文 %%不导出\n\n这也是注释%% 后文\n\n<!--隐藏-->\n\n`%%代码%%`\n\n$$\n\\verb|%%公式%%|\n$$',
  );
  expect(root.textContent).not.toContain('不导出');
  expect(root.textContent).not.toContain('这也是注释');
  expect(root.textContent).not.toContain('隐藏');
  expect(root.textContent).toContain('后文');
  expect(root.querySelector('code')?.textContent).toBe('%%代码%%');
  expect(root.querySelector('.katex')).not.toBeNull();
});
it('generates TOC using unique heading ids including Chinese repeated headings', () => {
  const root = html('[TOC]\n\n# 中文标题\n\n## 重复\n\n## 重复');
  const links = [...root.querySelectorAll('.note-toc a')];
  expect(links).toHaveLength(3);
  expect(new Set(links.map((link) => link.getAttribute('href'))).size).toBe(3);
  for (const link of links)
    expect(root.querySelector(`[id="${link.getAttribute('href')!.slice(1)}"]`)).not.toBeNull();
});
it('allows only the selected HTML subset and strips attributes from allowed tags', () => {
  const root = html(
    '<u onclick="alert(1)">下划线</u><br><sup>2</sup><sub>3</sub><mark>重点</mark>\n\n<details>\n<summary>更多</summary>\n\n**内容**\n\n</details>\n\n<script>alert(1)</script>',
  );
  expect(root.querySelector('u')?.textContent).toBe('下划线');
  expect(root.querySelector('u')?.attributes.length).toBe(0);
  expect(root.querySelector('br')).not.toBeNull();
  expect(root.querySelector('details summary')?.textContent).toBe('更多');
  expect(root.querySelector('details strong')?.textContent).toBe('内容');
  expect(root.querySelector('script')).toBeNull();
});
it('renders sized wiki images through the existing asset resolver', () => {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown('![[示意.png|240x120]]', {
    ...options,
    resolveAsset: () => 'data:image/png;base64,aA==',
  });
  const image = root.querySelector('img');
  expect(image?.getAttribute('data-asset-src')).toBe('示意.png');
  expect(image?.getAttribute('width')).toBe('240');
  expect(image?.getAttribute('height')).toBe('120');
});
const notes: Record<string, string> = {
  '知识.md': '# 定义\n\n接口是一份契约。 ^contract\n\n## 示例\n\n第二部分。',
  '循环.md': '![[循环.md]]',
};
const resolveNote = (path: string) =>
  notes[path] === undefined ? { error: `找不到笔记：${path}` } : { path, source: notes[path] };
it('embeds notes, heading sections and paragraph blocks without rewriting source', () => {
  for (const [target, expected, excluded] of [
    ['知识.md', '接口是一份契约', '不可能出现'],
    ['知识.md#定义', '接口是一份契约', '不可能出现'],
    ['知识.md#^contract', '接口是一份契约', '第二部分'],
  ]) {
    const source = `![[${target}]]`;
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown(source, { ...options, resolveNote });
    expect(root.querySelector('.note-embed-body')?.textContent).toContain(expected);
    expect(root.querySelector('.note-embed-body')?.textContent).not.toContain(excluded);
    expect(root.querySelector('.note-embed-open')?.getAttribute('href')).toBe(target);
  }
});
it('reports unresolved, cyclic and ambiguous block targets rather than silently showing other content', () => {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown('![[缺失.md]]\n\n![[循环.md]]', { ...options, resolveNote });
  expect(root.querySelectorAll('.note-reference-error')).toHaveLength(2);
  expect(root.textContent).toContain('循环');
  expect(root.textContent).toContain('找不到');
  const duplicate = html('段落甲 ^same\n\n段落乙 ^same');
  expect(duplicate.querySelectorAll('[id="block-same"]')).toHaveLength(0);
  expect(duplicate.textContent).toContain('重复');
});
it('keeps reading output consistent and expands all folded content for PDF', () => {
  const source =
    '> [!info]- 标题\n> ==正文==\n\n<details>\n<summary>补充</summary>\n\n内容\n\n</details>';
  expect(renderReadingMarkdown(source, options).replace(/ data-source-line="\d+"/g, '')).toBe(
    renderMarkdown(source, options),
  );
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(source, { ...options, exportMode: 'pdf' });
  expect(root.querySelectorAll('details[open]')).toHaveLength(2);
});
it('leaves the current-version renderer unchanged unless prototype syntax is requested', () => {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown('==内容==\n\n> [!info]\n> 内容');
  expect(root.querySelector('mark,[data-callout]')).toBeNull();
});
it('includes headings inside details in the same unique TOC', () => {
  const root = html(
    '[TOC]\n\n# 同名\n\n<details>\n<summary>详情</summary>\n\n## 同名\n\n</details>',
  );
  expect(root.querySelectorAll('.note-toc a')).toHaveLength(2);
  const ids = [...root.querySelectorAll('h1,h2')].map((h) => h.id);
  expect(new Set(ids).size).toBe(2);
});
it('allows an acyclic same-note section embed', () => {
  const source = '# 定义\n\n一份契约。\n\n# 引用\n\n![[#定义]]';
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(source, {
    ...options,
    notePath: '当前.md',
    resolveNote: () => ({ path: '当前.md', source }),
  });
  expect(root.querySelector('.note-embed-body')?.textContent).toContain('一份契约');
  expect(root.querySelector('.note-reference-error')).toBeNull();
});
