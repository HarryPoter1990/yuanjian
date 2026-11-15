import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { livePreviewField, previewConfig } from '../src/editor/live-preview';
const create = (doc: string, anchor: number) =>
  EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown(),
      previewConfig.of({ mode: 'live', prototypeEditing: true }),
      livePreviewField,
    ],
  });
function snapshot(state: EditorState) {
  const ranges: unknown[] = [];
  state.field(livePreviewField).decorations.between(0, state.doc.length, (from, to, value) => {
    ranges.push({
      from,
      to,
      class: value.spec.class,
      attributes: value.spec.attributes,
      widget: value.spec.widget?.constructor.name,
    });
  });
  return ranges;
}
it('incremental preview stays identical to fresh parsing across text and structural edits', () => {
  let state = create(
    '# 学习标题\n\n正文 **重点** 和 $x+1$。\n\n- [ ] 完成学习\n\n> [!info] 提示\n> 下一步\n\n'.repeat(
      30,
    ),
    4,
  );
  for (const insert of [
    '中文',
    '\n',
    '**',
    '\n```java\nclass Demo {}\n```\n',
    '\n> 引用\n',
    '%%隐藏%%',
    '\n$$\nx^2\n$$\n',
  ]) {
    const from = Math.floor(state.doc.length / 2);
    state = state.update({
      changes: { from, insert },
      selection: { anchor: from + insert.length },
    }).state;
    const fresh = create(state.doc.toString(), state.selection.main.head);
    expect(snapshot(state)).toEqual(snapshot(fresh));
  }
});
