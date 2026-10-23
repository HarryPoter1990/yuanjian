import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { CompletionContext } from '@codemirror/autocomplete';
import { describe, expect, it } from 'vitest';
import { activeMathRange, inMath, mathCompletionSource } from '../src/editor/completion';
import { createMarkdownParser } from '../src/editor/renderer';

function at(source: string, position = source.length) {
  return EditorState.create({
    doc: source,
    selection: { anchor: position },
    extensions: [markdown()],
  });
}

describe('shared formula context', () => {
  it('leaves adjacent complete inline formulas before a new opening dollar', () => {
    const source = '$a$$b$';
    expect(
      createMarkdownParser()
        .parseInline(source, {})[0]
        .children?.map((token) => token.type),
    ).toEqual(['inline_math', 'inline_math']);
    expect(inMath(at(source), source.length)).toBe(false);
  });

  it.each(['`$` 普通文字 ', '`$$`\n\n普通文字 ', '```text\n$$\n```\n\n正文 '])(
    'does not count code dollars in later prose: %s',
    (source) => {
      const state = at(source);
      expect(activeMathRange(state)).toBeNull();
      expect(inMath(state, source.length)).toBe(false);
    },
  );

  it('previews the actual formula after a literal dollar in inline code', () => {
    const source = '`$` $x$';
    expect(activeMathRange(at(source, source.indexOf('x') + 1))).toEqual({
      source: 'x',
      from: source.indexOf('$x$'),
      to: source.length,
    });
  });

  it.each(['$\\alpha', '$$\n\\alpha', '$$x\n\\alpha'])(
    'completes unfinished math: %s',
    (source) => {
      const state = at(source);
      expect(inMath(state, source.length)).toBe(true);
      expect(activeMathRange(state)).toBeNull();
      expect(
        mathCompletionSource([])(new CompletionContext(state, source.length, true))?.options,
      ).toContainEqual({ label: '\\alpha', type: 'function' });
    },
  );

  it('does not carry unfinished inline math over a newline', () => {
    const source = '$unfinished\nordinary';
    expect(inMath(at(source), source.length)).toBe(false);
  });

  it.each(['`$x$`', '```text\n$x$\n```'])('does not preview or complete code: %s', (source) => {
    const position = source.indexOf('x') + 1;
    expect(activeMathRange(at(source, position))).toBeNull();
    expect(inMath(at(source, position), position)).toBe(false);
  });
});
