import { expect, it } from 'vitest';
import { parseDelimited, guessDelimiter } from '../src/shared/delimited';
it('preserves quoted separators, escaped quotes, CRLF and newlines inside cells', () => {
  expect(parseDelimited('\ufeff姓名,说明\r\n甲,"一,二\n三"\r\n乙,"他说""你好"""\r\n', ',')).toEqual(
    [
      ['姓名', '说明'],
      ['甲', '一,二\n三'],
      ['乙', '他说"你好"'],
    ],
  );
});
it('preserves empty trailing fields and whitespace without adding a phantom last row', () => {
  expect(parseDelimited('甲\t\t\n乙\t  空格  \t', '\t')).toEqual([
    ['甲', '', ''],
    ['乙', '  空格  ', ''],
  ]);
});
it('rejects malformed quotes instead of silently inventing table cells', () => {
  expect(() => parseDelimited('a,"b', ',')).toThrow(/未闭合/);
  expect(() => parseDelimited('a,"b"oops', ',')).toThrow(/引号结束/);
});
it('guesses a semicolon-separated CSV while respecting quoted commas', () => {
  expect(guessDelimiter('姓名;说明\n甲;"一,二"', 'csv')).toBe(';');
  expect(guessDelimiter('姓名\t值\n甲\t1', 'tsv')).toBe('\t');
});
it('retains rows of uneven width for later padding and rejects oversized width explicitly', () => {
  expect(parseDelimited('a,b\nc,d,e', ',')).toEqual([
    ['a', 'b'],
    ['c', 'd', 'e'],
  ]);
  expect(() => parseDelimited(Array(514).fill('a').join(','), ',')).toThrow(/512/);
});
it('bounds total cells across otherwise valid rows without truncating data', () => {
  const row = Array(100).fill('cell').join(',');
  expect(parseDelimited(Array(1000).fill(row).join('\n'), ',')).toHaveLength(1000);
  expect(() => parseDelimited(Array(1001).fill(row).join('\n'), ',')).toThrow(/100000.*单元格/);
});
