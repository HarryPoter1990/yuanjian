// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { insertNoteSyntax } from '../src/editor/note-insertions';
const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});
function editor(doc: string, from = doc.length, to = from) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
      extensions: [markdown(), history()],
    }),
  });
  vi.spyOn(view, 'focus').mockImplementation(() => {});
  views.push(view);
  return view;
}
it('wraps selected text and toggles it off without losing the selection or undo', () => {
  const view = editor('前 重点 后', 2, 4);
  expect(insertNoteSyntax(view, 'highlight')).toBe(true);
  expect(view.state.doc.toString()).toBe('前 ==重点== 后');
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
    '重点',
  );
  insertNoteSyntax(view, 'highlight');
  expect(view.state.doc.toString()).toBe('前 重点 后');
  undo(view);
  expect(view.state.doc.toString()).toBe('前 ==重点== 后');
});
it('chooses an unused footnote label and selects the editable definition', () => {
  const source = '已有[^注]\n\n[^注]: 旧注释\n\n新内容';
  const view = editor(source);
  insertNoteSyntax(view, 'footnote');
  expect(view.state.doc.toString()).toContain('正文[^注2]\n\n[^注2]: 补充说明');
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
    '补充说明',
  );
  undo(view);
  expect(view.state.doc.toString()).toBe(source);
});
it('preserves selected paragraphs inside a callout', () => {
  const source = '第一段\n\n第二段';
  const view = editor(source, 0, source.length);
  insertNoteSyntax(view, 'callout');
  expect(view.state.doc.toString()).toBe('> [!info] 提示\n> 第一段\n> \n> 第二段\n\n');
});
it('does not apply note formatting inside code or across lines of an inline format', () => {
  for (const [source, from, to] of [
    ['```js\nconst a=1;\n```', 10, 10],
    ['第一行\n第二行', 0, 7],
  ] as const) {
    const view = editor(source, from, to);
    expect(insertNoteSyntax(view, 'highlight')).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  }
});
