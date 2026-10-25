import { serializeTable, type Alignment } from './table';

export interface HtmlTableGrid {
  rows: string[][];
  alignments: Alignment[];
  hasHeader: boolean;
  notices: string[];
}

/** Keep literal text literal when CSV/TSV cells enter the Markdown representation. */
export function plainTableCell(text: string): string {
  return text.replace(/\r\n?|\n/g, '\n').replace(/[\\`*_{}[\]<>!]/g, '\\$&');
}

export function markdownTableFromGrid(
  rows: readonly (readonly string[])[],
  hasHeader: boolean,
  alignments: readonly Alignment[] = [],
): string {
  const columns = rows.reduce((width, row) => Math.max(width, row.length), 0);
  if (!columns) return '';
  if (columns * (rows.length + (hasHeader ? 0 : 1)) > 100000)
    throw new Error('表格展开后超过 100000 个单元格');
  const complete = rows.map((row) => Array.from({ length: columns }, (_, i) => row[i] ?? ''));
  return serializeTable({
    rows: hasHeader ? complete : [Array<string>(columns).fill(''), ...complete],
    alignments: Array.from({ length: columns }, (_, i) => alignments[i] ?? 'none'),
  });
}

function flattenNestedTables(cell: HTMLElement): HTMLElement {
  const copy = cell.cloneNode(true) as HTMLElement;
  for (const nested of [...copy.querySelectorAll('table')].reverse()) {
    const replacement = copy.ownerDocument.createElement('div');
    if (nested.caption) {
      const caption = copy.ownerDocument.createElement('div');
      caption.innerHTML = nested.caption.innerHTML;
      replacement.append(caption);
    }
    for (const row of nested.rows) {
      const line = copy.ownerDocument.createElement('div');
      [...row.cells].forEach((value, index) => {
        if (index) line.append(copy.ownerDocument.createTextNode(' | '));
        for (const child of value.childNodes) line.append(child.cloneNode(true));
      });
      replacement.append(line);
    }
    nested.replaceWith(replacement);
  }
  return copy;
}

/** The caller sanitizes HTML before passing the detached table and cell converter. */
export function readHtmlTable(
  table: HTMLTableElement,
  convertCell: (html: string) => string,
): HtmlTableGrid {
  const input = [...table.rows];
  const first = input[0];
  const hasHeader = Boolean(
    first &&
    (first.parentElement?.tagName === 'THEAD' ||
      (first.cells.length > 0 && [...first.cells].every((cell) => cell.tagName === 'TH'))),
  );
  const rows: string[][] = [];
  const occupied: boolean[][] = [];
  const alignments: Alignment[] = [];
  const notices = new Set<string>();
  let allocated = 0;
  input.forEach((row, r) => {
    rows[r] ??= [];
    occupied[r] ??= [];
    let column = 0;
    for (const cell of row.cells) {
      while (occupied[r][column]) column++;
      const across = Math.max(1, cell.colSpan);
      const down = Math.max(1, Math.min(cell.rowSpan || input.length - r, input.length - r));
      // Refuse unbounded span expansion; the caller retains all readable source text with a notice.
      allocated += across * down;
      if (allocated > 100000) throw new Error('表格展开后超过 100000 个单元格');
      if (across > 1 || down > 1)
        notices.add('合并单元格已展开为普通网格，文字保留在左上格，其余位置留空。');
      if (cell.querySelector('table')) notices.add('嵌套表格已按行保留在原单元格内。');
      const value = convertCell(flattenNestedTables(cell).innerHTML).trim();
      for (let y = r; y < r + down; y++) {
        rows[y] ??= [];
        occupied[y] ??= [];
        for (let x = column; x < column + across; x++) {
          if (occupied[y][x]) throw new Error('表格合并范围重叠，无法安全展开');
          occupied[y][x] = true;
          rows[y][x] = y === r && x === column ? value : '';
        }
      }
      const align = (cell.getAttribute('align') || cell.style.textAlign).toLowerCase();
      if (!alignments[column] && ['left', 'right', 'center'].includes(align))
        alignments[column] = align as Alignment;
      column += across;
    }
  });
  if (input.filter((row) => row.parentElement?.tagName === 'THEAD').length > 1)
    notices.add('多层表头已简化为首行表头，其余行保留为普通行。');
  const width = rows.reduce((width, row) => Math.max(width, row.length), 0);
  if (width * rows.length > 100000) throw new Error('表格展开后超过 100000 个单元格');
  return {
    rows: rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? '')),
    alignments: Array.from({ length: width }, (_, i) => alignments[i] ?? 'none'),
    hasHeader,
    notices: [...notices],
  };
}
