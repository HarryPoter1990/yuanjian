import { WidgetType, type EditorView } from '@codemirror/view';
import {
  parseTable,
  serializeTable,
  serializeTableCell,
  tableCellRange,
  type Alignment,
} from './table';

const gridStates = new WeakMap<HTMLElement, { update(source: string): boolean }>();

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: TableWidget): boolean {
    return this.source === other.source && this.from === other.from && this.to === other.to;
  }
  updateDOM(container: HTMLElement, _view: EditorView, previous: TableWidget): boolean {
    if (this.source !== previous.source && !gridStates.get(container)?.update(this.source))
      return false;
    container.dataset.tableFrom = String(this.from);
    container.dataset.tableTo = String(this.to);
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markdown-table-widget';
    container.dataset.tableFrom = String(this.from);
    container.dataset.tableTo = String(this.to);
    container.contentEditable = 'false';
    container.setAttribute('aria-label', 'Markdown 表格网格编辑');
    const table = parseTable(this.source);
    if (!table) return container;
    let currentSource = this.source;
    const inputs: HTMLInputElement[][] = [];
    gridStates.set(container, {
      update(source) {
        const next = parseTable(source);
        if (
          !next ||
          next.rows.length !== inputs.length ||
          next.alignments.length !== inputs[0]?.length
        )
          return false;
        if (source !== currentSource) {
          currentSource = source;
          table.rows = next.rows;
          table.alignments = next.alignments;
        }
        inputs.forEach((row, r) =>
          row.forEach((input, c) => {
            if (input.value !== table.rows[r][c]) input.value = table.rows[r][c];
            input.style.textAlign = table.alignments[c] === 'none' ? 'left' : table.alignments[c];
          }),
        );
        return true;
      },
    });
    let rowIndex = 0;
    let columnIndex = 0;
    const commit = (): void => {
      const keepFocus = container.contains(document.activeElement);
      const from = Number(container.dataset.tableFrom);
      const to = Number(container.dataset.tableTo);
      if (view.state.doc.sliceString(from, to) !== currentSource) return;
      const insert = serializeTable(table);
      currentSource = insert;
      view.dispatch({ changes: { from, to, insert }, userEvent: 'input.table' });
      if (keepFocus)
        queueMicrotask(() =>
          view.dom
            .querySelector<HTMLInputElement>(
              `[data-table-from="${from}"] input[data-row="${Math.min(rowIndex, table.rows.length - 1)}"][data-column="${Math.min(columnIndex, table.alignments.length - 1)}"]`,
            )
            ?.focus({ preventScroll: true }),
        );
    };
    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '当前表格行列与对齐');
    const action = (label: string, run: () => void): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', run);
      toolbar.append(button);
    };
    action('+ 行', () => {
      table.rows.splice(
        rowIndex + 1,
        0,
        table.alignments.map(() => ''),
      );
      commit();
    });
    action('− 行', () => {
      if (rowIndex > 0) {
        table.rows.splice(rowIndex, 1);
        commit();
      }
    });
    action('+ 列', () => {
      for (const row of table.rows) row.splice(columnIndex + 1, 0, '');
      table.alignments.splice(columnIndex + 1, 0, 'none');
      commit();
    });
    action('− 列', () => {
      if (table.alignments.length > 1) {
        for (const row of table.rows) row.splice(columnIndex, 1);
        table.alignments.splice(columnIndex, 1);
        commit();
      }
    });
    const alignments: [string, Alignment][] = [
      ['左对齐', 'left'],
      ['居中', 'center'],
      ['右对齐', 'right'],
    ];
    for (const [label, alignment] of alignments)
      action(label, () => {
        table.alignments[columnIndex] = alignment;
        commit();
      });
    container.append(toolbar);
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    const grid = document.createElement('table');
    grid.style.minWidth = `${table.alignments.length * 128}px`;
    table.rows.forEach((row, rowNumber) => {
      inputs[rowNumber] = [];
      const tr = document.createElement('tr');
      row.forEach((value, columnNumber) => {
        const td = document.createElement(rowNumber === 0 ? 'th' : 'td');
        const input = document.createElement('input');
        input.value = value;
        let originalValue = value;
        input.setAttribute('aria-label', `表格第 ${rowNumber + 1} 行第 ${columnNumber + 1} 列`);
        input.style.textAlign =
          table.alignments[columnNumber] === 'none' ? 'left' : table.alignments[columnNumber];
        input.addEventListener('focus', () => {
          rowIndex = rowNumber;
          columnIndex = columnNumber;
          originalValue = input.value;
        });
        const writeCell = () => {
          table.rows[rowNumber][columnNumber] = input.value;
          const range = tableCellRange(currentSource, rowNumber, columnNumber);
          const from = Number(container.dataset.tableFrom);
          const to = Number(container.dataset.tableTo);
          if (!range || view.state.doc.sliceString(from, to) !== currentSource) return;
          const insert = serializeTableCell(input.value);
          if (currentSource.slice(range.from, range.to) === insert) return;
          currentSource =
            currentSource.slice(0, range.from) + insert + currentSource.slice(range.to);
          view.dispatch({
            changes: { from: from + range.from, to: from + range.to, insert },
            userEvent: 'input.table',
          });
        };
        input.addEventListener('input', writeCell);
        input.dataset.row = String(rowNumber);
        input.dataset.column = String(columnNumber);
        input.addEventListener('keydown', (event) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
          if (event.key === 'Escape') {
            input.value = originalValue;
            writeCell();
            input.blur();
            view.focus();
          }
        });
        td.append(input);
        inputs[rowNumber][columnNumber] = input;
        tr.append(td);
      });
      grid.append(tr);
    });
    scroll.append(grid);
    container.append(scroll);
    return container;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
