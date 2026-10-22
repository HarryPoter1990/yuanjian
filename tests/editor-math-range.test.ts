import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import { activeMathRange, inMath } from '../src/editor/completion';

function at(source: string, position: number) {
  return EditorState.create({
    doc: source,
    selection: { anchor: position },
    extensions: [markdown()],
  });
}

describe('active formula delimiter escaping', () => {
  it.each([0, 1, 2, 3, 4])(
    'uses the parity of %i backslashes before an inline opening delimiter',
    (count) => {
      const prefix = '\\'.repeat(count);
      const state = at(`${prefix}$x$`, prefix.length + 2);
      expect(inMath(state, state.selection.main.head)).toBe(count % 2 === 0);
      expect(activeMathRange(state)).toEqual(
        count % 2 ? null : { source: 'x', from: prefix.length, to: prefix.length + 3 },
      );
    },
  );

  it.each([1, 3])('keeps a dollar escaped by %i backslashes inside inline math', (count) => {
    const body = `x${'\\'.repeat(count)}$y`;
    expect(activeMathRange(at(`$${body}$`, 2))).toEqual({
      source: body,
      from: 0,
      to: body.length + 2,
    });
  });

  it.each([0, 2, 4])('accepts an inline closing dollar after %i backslashes', (count) => {
    const body = `x${'\\'.repeat(count)}`;
    expect(activeMathRange(at(`$${body}$ tail $`, 2))).toEqual({
      source: body,
      from: 0,
      to: body.length + 2,
    });
  });

  it.each([0, 1, 2, 3, 4])(
    'uses the parity of %i backslashes before a block opening delimiter',
    (count) => {
      const prefix = '\\'.repeat(count);
      const source = `${prefix}$$\nx\n$$`;
      expect(activeMathRange(at(source, source.indexOf('x') + 1))).toEqual(
        count % 2 ? null : { source: '\nx\n', from: prefix.length, to: source.length },
      );
    },
  );

  it('keeps an escaped block delimiter in the formula body', () => {
    const body = '\nx\\$$y\n';
    const source = `$$${body}$$`;
    expect(activeMathRange(at(source, source.indexOf('x') + 1))).toEqual({
      source: body,
      from: 0,
      to: source.length,
    });
  });

  it.each([0, 2, 4])('accepts a block closing delimiter after %i backslashes', (count) => {
    const body = `\nx${'\\'.repeat(count)}`;
    const source = `$$${body}$$`;
    expect(activeMathRange(at(source, source.indexOf('x') + 1))).toEqual({
      source: body,
      from: 0,
      to: source.length,
    });
  });

  it('ignores block delimiters inside fenced code', () => {
    const source = '```text\n$$ignored$$\n```\n\n$x$';
    expect(activeMathRange(at(source, source.lastIndexOf('x') + 1))).toEqual({
      source: 'x',
      from: source.lastIndexOf('$x$'),
      to: source.length,
    });
  });
});
