import { describe, expect, it } from 'vitest';
import {
  extractHeadings,
  extractLinks,
  extractTags,
  parseNote,
  setFrontmatterTags,
} from '../src/shared/markdown';

describe('Markdown 文件结构', () => {
  it('大纲保留中文标题、源行号和重复标题锚点', () => {
    const source = '---\ntags: [Java]\n---\n# 学习记录\n\n## 异常处理\n\n## 异常处理\n';
    expect(extractHeadings(source)).toEqual([
      { level: 1, text: '学习记录', line: 4, id: '学习记录' },
      { level: 2, text: '异常处理', line: 6, id: '异常处理' },
      { level: 2, text: '异常处理', line: 8, id: '异常处理-1' },
    ]);
  });
  it('标签合并顶部属性和正文，不把代码里的注释当标签', () => {
    const source =
      '---\ntags: [Java, 数学]\n---\n学习 #Java #复习/周一\n\n`#不是标签`\n\n```python\n# 注释不是标签\nprint("#示例")\n```';
    expect(extractTags(source).sort()).toEqual(['Java', '数学', '复习/周一'].sort());
  });
  it('提取标准与双链，分清图片并排除代码示例中的链接', () => {
    const source =
      '# 标题\n\n[学习](../Java.md#异常) [[另一篇#标题|别名]] ![图](assets/示例.png) ![[插图.png]]\n\n`[[代码]]`\n\n```md\n[示例](假的.md)\n```';
    const links = extractLinks(source);
    expect(links.map((link) => [link.target, link.image])).toEqual([
      ['../Java.md#异常', false],
      ['另一篇#标题', false],
      ['assets/示例.png', true],
      ['插图.png', true],
    ]);
  });
  it('只修改属性块，保留正文及CRLF原样', () => {
    const source =
      '---\r\ntitle: 原题\r\ntags: [旧]\r\n---\r\n\r\n# 原题\r\n\r\n*  不规整也保留\r\n';
    const result = setFrontmatterTags(source, ['新', 'Java']);
    expect(result.slice(result.indexOf('---\r\n', 4) + 5)).toBe(
      '\r\n# 原题\r\n\r\n*  不规整也保留\r\n',
    );
    expect(extractTags(result)).toEqual(['新', 'Java']);
    expect(result).toContain('title: 原题');
  });
  it('新属性不会吞掉正文，文档标题优先第一条一级标题', () => {
    const content = '# 学习\n\n  原文末尾  \n';
    const changed = setFrontmatterTags(content, ['Java']);
    expect(changed.endsWith(content)).toBe(true);
    expect(parseNote(changed, 'D:/笔记/别名.md').title).toBe('学习');
    expect(parseNote('普通文字', 'D:\\笔记\\数学.md').title).toBe('数学');
  });
  it('拒绝修改明确但损坏的顶部属性，普通横线里的列表正文原样保留', () => {
    expect(() => setFrontmatterTags('---\ntags: [未关闭\n---\n# 正文\n', ['新'])).toThrow(/属性/);
    const source = '---\n- 列表\n---\n# 正文\n';
    const changed = setFrontmatterTags(source, ['新']);
    expect(changed.endsWith(source)).toBe(true);
    expect(extractTags(changed)).toEqual(['新']);
    expect(extractHeadings(changed)[0].text).toBe('正文');
  });
});
