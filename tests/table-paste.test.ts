// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clipboardMatrix, planMatrixPaste } from '../src/editor/table-paste';
import { parseTable } from '../src/editor/table';

describe('shared matrix recognition and planning', () => {
  it('keeps quoted TSV cell newlines and literal Markdown text', () => {
    expect(clipboardMatrix('', '**literal**\t"a\n\nb"\r\nc\td')?.rows).toEqual([
      ['\\*\\*literal\\*\\*', 'a\n\nb'],
      ['c', 'd'],
    ]);
  });
  it('does not turn an ordinary multiline paragraph into a matrix', () => {
    expect(clipboardMatrix('', 'first\n\nsecond')).toBeNull();
  });
  it('does not discard surrounding rich prose when a table is part of a larger paragraph selection', () => {
    expect(
      clipboardMatrix('<p>keep prose</p><table><tr><td>x</td></tr></table>', 'keep prose x'),
    ).toBeNull();
    expect(
      clipboardMatrix(
        '<p>keep prose</p><table><tr><td>x</td><td>y</td></tr></table>',
        'keep prose\nx\ty',
      ),
    ).toBeNull();
  });
  it('lets an empty HTML table fall back to the accompanying text rather than swallowing the paste', () => {
    expect(clipboardMatrix('<table></table>', '必须保留的文字')).toBeNull();
  });
  it('takes the HTML cells directly without the generated empty Markdown header', () => {
    expect(clipboardMatrix('<table><tr><td>x</td><td>y</td></tr></table>', '')?.rows).toEqual([
      ['x', 'y'],
    ]);
  });
  it('counts only changed nonempty targets as overwrites and retains original source model', () => {
    const source = '| A | B |\n| :--- | ---: |\n| same | old |';
    const plan = planMatrixPaste(source, 1, 0, [
      ['same', 'new'],
      ['later', 'row'],
    ])!;
    expect(plan.overwrite).toBe(1);
    expect(parseTable(plan.source)?.rows).toEqual([
      ['A', 'B'],
      ['same', 'new'],
      ['later', 'row'],
    ]);
    expect(plan.table.alignments).toEqual(['left', 'right']);
    expect(source).toContain('old');
  });
});
