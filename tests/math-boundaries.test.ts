import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { prototypeMathRanges } from '../src/editor/prototype-preview';
import { createMarkdownParser } from '../src/editor/renderer';

it.each(['价格 \\$5，计算 $x+1$。', '公式 $x + \\text{\\$5}$。', '普通 $x+1$ 和 $y$。'])(
  'uses the same inline math boundaries in editing and reading: %s',
  (source) => {
    const state = EditorState.create({ doc: source, extensions: [markdown()] });
    const reading = createMarkdownParser()
      .parseInline(source, {})
      .flatMap((token) => token.children ?? [])
      .filter((token) => token.type === 'inline_math')
      .map((token) => token.content);
    expect(prototypeMathRanges(state).map((range) => range.body)).toEqual(reading);
  },
);
