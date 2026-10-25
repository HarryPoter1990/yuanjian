export type Delimiter = ',' | '\t' | ';';

/** CSV quoting applies equally to TSV; line breaks inside quoted cells remain cell data. */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false,
    cells = 0;
  const cell = () => {
    row.push(field);
    if (++cells > 100000) throw new Error('表格超过 100000 个单元格，本次未导入。');
    if (row.length > 512) throw new Error('表格超过 512 列，本次未导入。');
    field = '';
    closed = false;
  };
  const line = () => {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > 100000) throw new Error('表格超过 100000 行，本次未导入；原文件未修改。');
  };
  const source = text.replace(/^\ufeff/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === delimiter) {
      cell();
    } else if (char === '\r' || char === '\n') {
      line();
      if (char === '\r' && source[i + 1] === '\n') i++;
    } else if (char === '"' && field === '' && !closed) quoted = true;
    else if (closed && /[ \t]/.test(char)) continue;
    else if (closed) throw new Error('引号结束后有非分隔内容，请检查分隔符或原文件。');
    else field += char;
  }
  if (quoted) throw new Error('表格中有未闭合的引号，请检查原文件；本次未导入。');
  if (field || row.length || closed) line();
  return rows;
}

export function guessDelimiter(text: string, format: 'csv' | 'tsv'): Delimiter {
  if (format === 'tsv') return '\t';
  let best: Delimiter = ',',
    score = 0;
  for (const delimiter of [',', '\t', ';'] as const) {
    try {
      const sample = parseDelimited(text, delimiter).slice(0, 20);
      const widths = sample.map((row) => row.length);
      const width = widths[0] ?? 0;
      const current = width > 1 ? widths.filter((value) => value === width).length * width : 0;
      if (current > score) {
        score = current;
        best = delimiter;
      }
    } catch {
      /* A different separator may resolve the user's quoted fields. */
    }
  }
  return best;
}
