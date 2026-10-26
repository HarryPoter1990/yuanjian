// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { renderMarkdown } from '../src/editor/renderer';
import { markdownBlocks } from '../src/editor/live-preview';
import { footnoteLine } from '../src/shared/footnotes';
import { extractHeadings, extractLinks } from '../src/shared/markdown';
const source = '开头[^注]\n\n再次引用[^注]\n\n[^注]: 注释 **正文** 与 [链接](other.md)\n';
it('renders and maps footnote definitions and every return link without altering source', () => {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(source);
  expect(root.querySelectorAll('.footnote-ref')).toHaveLength(2);
  expect(root.querySelector('.footnote-item')?.textContent).toContain('注释 正文');
  expect(footnoteLine(source, 'fn1')).toBe(5);
  expect(footnoteLine(source, 'fnref1')).toBe(1);
  expect(footnoteLine(source, 'fnref1:1')).toBe(3);
  const state = EditorState.create({ doc: source });
  const blocks = markdownBlocks(state);
  expect(blocks.find((item) => item.type === 'footnote_open')?.source).toContain('[^注]:');
  expect(state.doc.toString()).toBe(source);
  expect(extractLinks(source).map((item) => item.target)).toEqual(['other.md']);
});
it('does not generate duplicate ids when a real heading uses a footnote id', () => {
  const text = '# fn1\n\n' + source;
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(text);
  const ids = [...root.querySelectorAll('[id]')].map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(extractHeadings(text)[0].id).toBe(root.querySelector('h1')?.id);
});
