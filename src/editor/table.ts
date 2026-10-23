export type Alignment = 'left' | 'center' | 'right' | 'none';
export interface MarkdownTable {
  rows: string[][];
  alignments: Alignment[];
}

export function tableCellRange(
  source: string,
  row: number,
  column: number,
): { from: number; to: number } | null {
  const lines = source.split('\n');
  const lineIndex = row === 0 ? 0 : row + 1;
  const line = lines[lineIndex];
  if (line === undefined) return null;
  const start = line.search(/\S|$/) + (line.trimStart().startsWith('|') ? 1 : 0);
  let end = line.trimEnd().length;
  let slashes = 0;
  for (let index = end - 2; index >= 0 && line[index] === '\\'; index--) slashes++;
  if (line[end - 1] === '|' && slashes % 2 === 0) end--;
  let cellStart = start,
    cellIndex = 0,
    codeTicks = 0;
  for (let index = start; index <= end; index++) {
    const char = line[index];
    if (index < end && char === '\\') {
      index++;
      continue;
    }
    if (index < end && char === '`') {
      let ticks = 1;
      while (line[index + ticks] === '`') ticks++;
      codeTicks = codeTicks === ticks ? 0 : codeTicks || ticks;
      index += ticks - 1;
      continue;
    }
    if (index === end || (char === '|' && !codeTicks)) {
      if (cellIndex === column) {
        const raw = line.slice(cellStart, index);
        const from = cellStart + raw.length - raw.trimStart().length;
        const to = Math.max(from, index - (raw.length - raw.trimEnd().length));
        const offset = lines
          .slice(0, lineIndex)
          .reduce((length, text) => length + text.length + 1, 0);
        return { from: offset + from, to: offset + to };
      }
      cellIndex++;
      cellStart = index + 1;
    }
  }
  return null;
}

export const serializeTableCell = (value: string): string =>
  value
    .replace(/\r?\n/g, '<br>')
    .replace(
      /(\\*)\|/g,
      (_match, slashes: string) => slashes + (slashes.length % 2 ? '' : '\\') + '|',
    );

export function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith('|')) source = source.slice(1);
  let closingSlashes = 0;
  for (let index = source.length - 2; index >= 0 && source[index] === '\\'; index--)
    closingSlashes++;
  if (source.endsWith('|') && closingSlashes % 2 === 0) source = source.slice(0, -1);
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
  const row = (values: string[]): string => `| ${values.map(serializeTableCell).join(' | ')} |`;
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
