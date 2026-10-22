export type Alignment = 'left' | 'center' | 'right' | 'none';
export interface MarkdownTable {
  rows: string[][];
  alignments: Alignment[];
}

export function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  let codeTicks = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\\' && index + 1 < source.length) {
      current += char + source[++index];
    } else if (char === '`') {
      let ticks = 1;
      while (source[index + ticks] === '`') ticks++;
      current += '`'.repeat(ticks);
      codeTicks = codeTicks === ticks ? 0 : codeTicks || ticks;
      index += ticks - 1;
    } else if (char === '|' && !codeTicks) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseTable(source: string): MarkdownTable | null {
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const headers = splitTableRow(lines[0]);
  const delimiters = splitTableRow(lines[1]);
  if (
    !delimiters.length ||
    delimiters.length !== headers.length ||
    delimiters.some((value) => !/^:?-+:?$/.test(value))
  )
    return null;
  const alignments: Alignment[] = delimiters.map((value) =>
    value.startsWith(':') && value.endsWith(':')
      ? 'center'
      : value.endsWith(':')
        ? 'right'
        : value.startsWith(':')
          ? 'left'
          : 'none',
  );
  const rows = [headers, ...lines.slice(2).map(splitTableRow)].map((row) =>
    headers.map((_, index) => row[index] ?? ''),
  );
  return { rows, alignments };
}

export function serializeTable(table: MarkdownTable): string {
  const cell = (value: string): string =>
    value.replace(/\r?\n/g, '<br>').replace(/(?<!\\)\|/g, '\\|');
  const row = (values: string[]): string => `| ${values.map(cell).join(' | ')} |`;
  const alignments = table.alignments.map((alignment) =>
    alignment === 'center'
      ? ':---:'
      : alignment === 'right'
        ? '---:'
        : alignment === 'left'
          ? ':---'
          : '---',
  );
  return [row(table.rows[0] ?? []), row(alignments), ...table.rows.slice(1).map(row)].join('\n');
}
