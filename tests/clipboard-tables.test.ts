// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { convertRichText, richTextToMarkdown } from '../src/editor/clipboard';
import { markdownTableFromGrid, plainTableCell, readHtmlTable } from '../src/editor/html-table';
import { parseTable } from '../src/editor/table';
import { renderMarkdown } from '../src/editor/renderer';

const simple = (value: string) =>
  `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>${value}</td><td>2</td></tr></tbody></table>`;
function grid(markdown: string) {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(markdown);
  return [...root.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('th,td')].map((cell) => cell.textContent),
  );
}
describe('rich clipboard table preservation', () => {
  it('reports simplification and empty-header insertion without counting source rows as headers', () => {
    const result = convertRichText('<table><tr><td colspan="2">原数据</td></tr></table>');
    expect(result.notices.join('\n')).toContain('空表头');
    expect(result.notices.join('\n')).toContain('左上格');
    expect(grid(result.markdown)).toEqual([
      ['', ''],
      ['原数据', ''],
    ]);
    const table = document.createElement('table');
    table.innerHTML = '<tr><td>A</td></tr>';
    expect(readHtmlTable(table, (html) => html)).toMatchObject({ rows: [['A']], hasHeader: false });
  });
  it('keeps plain CSV/TSV syntax literal when sharing Markdown table generation', () => {
    const source = markdownTableFromGrid(
      [['**literal**', 'a | b', '<br>', 'line\nnext']].map((row) => row.map(plainTableCell)),
      false,
    );
    expect(grid(source)[1].slice(0, 3)).toEqual(['**literal**', 'a | b', '<br>']);
    expect(parseTable(source)?.rows[1][3]).toBe('line<br>next');
  });
  it('inserts an empty header for TD-only tables without promoting the first data row', () => {
    const source = richTextToMarkdown(
      '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(grid(source)).toEqual([
      ['', ''],
      ['A', 'B'],
      ['1', '2'],
    ]);
    expect(source).not.toContain('<table');
  });
  it('keeps an actual header while converting pretty HTML with surrounding rich content', () => {
    const source = richTextToMarkdown(
      '<h2>标题</h2><p>前<strong>加粗</strong></p><table>\n<thead>\n<tr>\n<th>A</th>\n<th>B</th>\n</tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><pre><code class="language-java">int n = 1;</code></pre><p>后文</p>',
    );
    expect(grid(source)).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
    expect(source).toContain('## 标题');
    expect(source).toContain('**加粗**');
    expect(source).toContain('```java\nint n = 1;');
    expect(source).toContain('后文');
  });
  it.each([
    ['left | right', 'left | right'],
    ['<code>string | number</code>', 'string | number'],
  ])('preserves a pipe in %s without losing the following cell', (html, expected) => {
    const source = richTextToMarkdown(simple(html));
    expect(grid(source)).toEqual([
      ['A', 'B'],
      [expected, '2'],
    ]);
  });
  it('encodes BR and paragraph boundaries inside one physical Markdown row', () => {
    const source = richTextToMarkdown(simple('<p>first<br>second</p><p>third</p>'));
    expect(parseTable(source)?.rows).toEqual([
      ['A', 'B'],
      ['first<br>second<br><br>third', '2'],
    ]);
    expect(source.split('\n')).toHaveLength(3);
  });
  it('keeps inline links, code and formula source in cells', () => {
    const source = richTextToMarkdown(
      simple(
        '<a href="https://example.org/path">链接</a> <code>a | b</code> <span data-latex="x^2">x2</span>',
      ),
    );
    expect(source).toContain('[链接](https://example.org/path)');
    expect(source).toContain('`a \\| b`');
    expect(source).toContain('$x^2$');
    expect(grid(source)[1][1]).toBe('2');
  });
  it('expands rowspan/colspan to empty covered cells while preserving each original value once', () => {
    const source = richTextToMarkdown(
      '<table><thead><tr><th colspan="2">组合</th><th>值</th></tr></thead><tbody><tr><td rowspan="2">一次</td><td>甲</td><td>1</td></tr><tr><td>乙</td><td>2</td></tr></tbody></table>',
    );
    expect(grid(source)).toEqual([
      ['组合', '', '值'],
      ['一次', '甲', '1'],
      ['', '乙', '2'],
    ]);
    expect(source.match(/一次/g)).toHaveLength(1);
  });
  it('retains nested table text and caption rather than leaking raw TABLE markup', () => {
    const source = richTextToMarkdown(
      '<table><caption>说明</caption><tr><th>A</th></tr><tr><td>前<table><tr><td>内一</td><td>内二</td></tr></table>后</td></tr></table>',
    );
    expect(source).toContain('说明');
    expect(source).toContain('前');
    expect(source).toContain('内一');
    expect(source).toContain('内二');
    expect(source).toContain('后');
    expect(source).not.toContain('<table');
    expect(parseTable(source.slice(source.indexOf('| A')))?.rows).toHaveLength(2);
  });
  it('does not let an empty table downgrade the remaining formatted answer', () => {
    const source = richTextToMarkdown(
      '<p><strong>保留</strong></p><table></table><p>末尾</p>',
      '保留\n末尾',
    );
    expect(source).toContain('**保留**');
    expect(source).toContain('末尾');
  });
  it('keeps arbitrary HTML execution and dangerous links disabled', () => {
    const source = richTextToMarkdown(
      simple(
        '<img src=x onerror=evil()><a href="javascript:evil()">内容</a><script>evil()</script>',
      ),
    );
    const html = renderMarkdown(source);
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('javascript:');
    expect(source).not.toContain('<script');
  });
});
