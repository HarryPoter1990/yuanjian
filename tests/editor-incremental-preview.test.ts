// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { livePreviewField, markdownBlocks, previewConfig } from '../src/editor/live-preview';
function compare(source: string, from: number, to: number, insert: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [previewConfig.of({ mode: 'live' }), livePreviewField],
  });
  const next = state.update({ changes: { from, to, insert } }).state;
  const actual = next.field(livePreviewField).blocks;
  const full = markdownBlocks(next);
  const summary = (blocks: typeof actual) =>
    blocks.map(({ from, to, type, source, semanticKey, tokens }) => ({
      from,
      to,
      type,
      source,
      semanticKey,
      tokens: tokens.map((token) => ({
        type: token.type,
        map: token.map,
        content: token.content,
        attrs: token.attrs,
        children: token.children?.map((child) => ({
          type: child.type,
          content: child.content,
          attrs: child.attrs,
        })),
      })),
    }));
  expect(summary(actual)).toEqual(summary(full));
  return { actual, old: state.field(livePreviewField).blocks };
}
it('reparses plain paragraph text locally while preserving heading and footnote semantics', () => {
  const source = '# 同名\n\n# 同名\n\n普通文字\n\n正文[^注]\n\n[^注]: 注释\n';
  const at = source.indexOf('普通') + 2;
  const { actual, old } = compare(source, at, at, '新增');
  expect(actual[0].tokens).toBe(old[0].tokens);
});
it.each(['\n\n# 标题', '**加粗**', '[链接](a.md)', '[^新]', '\n---', '$$', '`code`'])(
  'fully invalidates structural edits: %s',
  (insert) => {
    const source = '# 开头\n\n普通文字\n\n尾段';
    const at = source.indexOf('普通') + 2;
    compare(source, at, at, insert);
  },
);
it('falls back when deleting a paragraph or making it an indented code block', () => {
  const source = '第一段\n\n普通文字\n\n最后';
  const at = source.indexOf('普通');
  compare(source, at, at + 4, '');
  compare(source, at, at, '    ');
});
it('rebuilds absolute checkbox offsets after a preceding plain paragraph changes length', () => {
  compare('普通文字\n\n- [ ] 后方任务', 0, 0, '新增');
});
