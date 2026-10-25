import { parseDelimited } from '../shared/delimited';
import { richTableGrid } from './clipboard';
import { plainTableCell } from './html-table';
import { parseTable, serializeTable, serializeTableCell, type MarkdownTable } from './table';

export function clipboardMatrix(
  html: string,
  plain: string,
): { rows: string[][]; notices: string[] } | null {
  const grid = richTableGrid(html);
  if (grid) return { rows: grid.rows, notices: grid.notices };
  if (/<table\b/i.test(html)) return null;
  if (!plain.includes('\t')) return null;
  const rows = parseDelimited(plain, '\t');
  if (!rows.some((row) => row.length > 1)) return null;
  return { rows: rows.map((row) => row.map(plainTableCell)), notices: [] };
}

export function planMatrixPaste(
  source: string,
  row: number,
  column: number,
  incoming: readonly (readonly string[])[],
): { source: string; table: MarkdownTable; overwrite: number } | null {
  const table = parseTable(source);
  if (
    !table ||
    row < 0 ||
    column < 0 ||
    row >= table.rows.length ||
    column >= table.alignments.length ||
    !incoming.length
  )
    return null;
  const width = Math.max(
    table.alignments.length,
    column + incoming.reduce((max, values) => Math.max(max, values.length), 0),
  );
  const height = Math.max(table.rows.length, row + incoming.length);
  if (width * height > 100000) throw new Error('表格展开后超过 100000 个单元格，未写入。');
  let overwrite = 0;
  const rows = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => table.rows[r]?.[c] ?? ''),
  );
  incoming.forEach((values, r) =>
    values.forEach((value, c) => {
      const original = rows[row + r][column + c];
      if (original.trim() && original !== serializeTableCell(value)) overwrite++;
      rows[row + r][column + c] = value;
    }),
  );
  const result = {
    rows,
    alignments: Array.from({ length: width }, (_, c) => table.alignments[c] ?? 'none'),
  };
  return { source: serializeTable(result), table: result, overwrite };
}
