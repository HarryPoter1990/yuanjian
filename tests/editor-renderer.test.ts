// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { createMarkdownParser, renderMarkdown, safeImageUrl } from '../src/editor/renderer';
import { markdownBlocks, livePreviewField, previewConfig } from '../src/editor/live-preview';
import { parseTable, serializeTable, splitTableRow } from '../src/editor/table';
import { richTextToMarkdown } from '../src/editor/clipboard';
import { extractHeadings } from '../src/shared/markdown';

describe('safe Markdown rendering', () => {
  it('renders Chinese, tasks, math, code and wiki links without executing raw HTML', () => {
    const html = renderMarkdown(
      '# 中文标题\n\n- [x] 学习\n\n$x^2$\n\n$$\n\\frac{a}{b}\n$$\n\n[[同名笔记#目标|继续]]\n\n```java\nclass Demo {}\n```\n\n<script>alert(1)</script>',
    );
    expect(html).toContain('<h1 id="中文标题">中文标题</h1>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('katex');
    expect(html).toContain('同名笔记#目标');
    expect(html).toContain('hljs-keyword');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('rejects dangerous links and keeps local images inactive until authorized', () => {
    const html = renderMarkdown(
      '[x](javascript:alert(1))\n\n![本地图](assets/中文.png)\n\n![在线](https://example.com/p.png)\n\n[[javascript:alert(2)|恶意]]',
    );
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(
      root.querySelector('img[data-asset-src="assets/中文.png"]')?.getAttribute('src'),
    ).toBeNull();
    expect(root.querySelector('img[src="https://example.com/p.png"]')).not.toBeNull();
    expect(safeImageUrl('file:///secret.png')).toBe(false);
    expect(safeImageUrl('note-asset://asset/token')).toBe(true);
  });
  it('does not treat currency without a closing delimiter as math', () => {
    expect(renderMarkdown('价格 $50')).not.toContain('katex');
    expect(createMarkdownParser().parse('$$x$$\n\n下一段', {})[0].map).toEqual([0, 1]);
  });
  it('assigns export heading anchors consistently with the document model', () => {
    const html = renderMarkdown('# 中文标题\n\n## 重复标题\n\n## 重复标题');
    expect(html).toContain('id="重复标题"');
    expect(html).toContain('id="重复标题-1"');
  });
  it('omits valid leading metadata from reading output while retaining source headings and line positions', () => {
    const source =
      '\uFEFF---\r\ntags: [学习]\r\ntitle: 文件属性标题\r\n---\r\n# 正文首标题\r\n\r\n## 重复标题\r\n\r\n## 重复标题';
    const html = renderMarkdown(source);
    expect(html).not.toContain('tags:');
    expect(html).not.toContain('文件属性标题');
    expect(html).not.toContain('<hr>');
    expect(html).toMatch(/^<h1 id="正文首标题">正文首标题<\/h1>/);
    expect(html).toContain('id="重复标题-1"');
    expect(extractHeadings(source)[0]).toMatchObject({
      text: '正文首标题',
      line: 5,
      id: '正文首标题',
    });
    const state = EditorState.create({ doc: source });
    const heading = markdownBlocks(state).find((block) => block.source === '# 正文首标题');
    expect(heading?.from).toBe(state.doc.line(5).from);
    expect(state.doc.toString()).toContain('tags: [学习]');
    expect(renderMarkdown('---\n\n---\n# 空属性后的标题')).toMatch(/^<h1 id="空属性后的标题">/);
  });
  it('keeps malformed, nonmapping and unclosed YAML visible instead of dropping body text', () => {
    for (const attributes of [
      'tags: [未闭合',
      '- 列表属性',
      '普通文字',
      'a: *missing',
      'a: 1\na: 2',
    ]) {
      const html = renderMarkdown(`---\n${attributes}\n---\n# 正文标题`);
      expect(html).toContain(attributes.split('\n')[0].replace(/^- /, '').replace('&', '&amp;'));
      expect(html).toContain('正文标题');
    }
    expect(renderMarkdown('---\ntags: [学习]\n# 没有闭合属性块')).toContain('tags: [学习]');
    expect(renderMarkdown('正文\n\n---\ntags: [不是开头属性]\n---')).toContain(
      'tags: [不是开头属性]',
    );
  });
});

describe('source-preserving block decorations', () => {
  const source =
    '# 中文标题\n\n普通  **段落**。\n第二行保持空格  \n\n```java\nclass Demo {}\n```\n\n| A | B |\n| :--- | ---: |\n| 一 | 二 |';
  it('leaves the active block in source and never serializes unrelated source', () => {
    let state = EditorState.create({
      doc: source,
      extensions: [previewConfig.of({ mode: 'live' }), livePreviewField],
    });
    expect(state.doc.toString()).toBe(source);
    expect(markdownBlocks(state).map((block) => block.type)).toEqual([
      'heading_open',
      'paragraph_open',
      'fence',
      'table_open',
    ]);
    expect(state.field(livePreviewField).decorations.size).toBe(3);
    const pos = source.indexOf('普通');
    state = state.update({ selection: { anchor: pos } }).state;
    expect(state.field(livePreviewField).decorations.size).toBe(3);
    const active = state.field(livePreviewField).decorations.iter();
    expect(active.from).toBe(0);
    state = state.update({ changes: { from: pos + 2, insert: '新增' } }).state;
    expect(state.doc.toString()).toBe(source.slice(0, pos + 2) + '新增' + source.slice(pos + 2));
  });
  it('source mode reveals the entire unmodified document', () => {
    const state = EditorState.create({
      doc: source,
      extensions: [previewConfig.of({ mode: 'source' }), livePreviewField],
    });
    expect(state.field(livePreviewField).decorations.size).toBe(0);
    expect(state.doc.toString()).toBe(source);
  });
});

describe('table and rich text conversion', () => {
  it('keeps escaped pipes and edits only a table serialization', () => {
    expect(splitTableRow('| a\\|b | `c|d` |')).toEqual(['a\\|b', '`c|d`']);
    const table = parseTable('| 姓名 | 分数 |\n| :--- | ---: |\n| 小明 | 95 |');
    expect(table?.alignments).toEqual(['left', 'right']);
    if (!table) throw new Error('table expected');
    table.rows[1][1] = '100';
    expect(serializeTable(table)).toContain('| 小明 | 100 |');
    expect(parseTable('ordinary text')).toBeNull();
  });
  it('converts headings, tables, code and LaTeX while dropping executable HTML', () => {
    const text = richTextToMarkdown(
      '<h2>学习</h2><p><strong>内容</strong> <a href="javascript:alert(1)">链接</a></p><pre><code>let x = 1;</code></pre><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math><script>evil()</script>',
    );
    expect(text).toContain('## 学习');
    expect(text).toContain('**内容**');
    expect(text).toContain('```');
    expect(text).toContain('$x^2$');
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('evil()');
  });
});
