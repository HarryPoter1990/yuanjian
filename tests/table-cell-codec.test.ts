import { describe, expect, it } from 'vitest';
import { decodeTableCellBreaks } from '../src/editor/table-cell';
import { serializeTableCell } from '../src/editor/table';

describe('shared table line-break codec', () => {
  it.each(['<br>', '<br/>', '<br />', '<BR>'])(
    'decodes %s while preserving Markdown markup',
    (marker) => {
      expect(decodeTableCellBreaks(`**a${marker}b**`)).toBe('**a\nb**');
    },
  );
  it.each([
    '`<br>`',
    '``a`<br>b``',
    '\\<br>',
    '&lt;br&gt;',
    '<br onclick=evil()>',
    '$\\text{<br>}$',
  ])('leaves %s literal', (source) => {
    expect(decodeTableCellBreaks(source)).toBe(source);
  });
  it('normalizes all physical line endings through the one-row Markdown representation', () => {
    expect(serializeTableCell('a\r\nb\rc\nd')).toBe('a<br>b<br>c<br>d');
    expect(decodeTableCellBreaks(serializeTableCell('a\n\nb'))).toBe('a\n\nb');
  });
});
