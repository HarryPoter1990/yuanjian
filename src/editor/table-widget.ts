import { WidgetType, type EditorView } from '@codemirror/view';
import { parseTable, serializeTable, type Alignment } from './table';

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
    if (this.source !== previous.source) return false;
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
    let rowIndex = 0;
    let columnIndex = 0;
    const commit = (): void => {
      const from = Number(container.dataset.tableFrom);
      const to = Number(container.dataset.tableTo);
      if (view.state.doc.sliceString(from, to) !== this.source) return;
      const insert = serializeTable(table);
      view.dispatch({ changes: { from, to, insert }, userEvent: 'input.table' });
    };
    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';
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
    const hint = document.createElement('small');
    hint.textContent = '选择单元格后操作行列 · 离开单元格保存 · 源码模式可编辑标记';
    toolbar.append(hint);
    container.append(toolbar);
    const grid = document.createElement('table');
    table.rows.forEach((row, rowNumber) => {
      const tr = document.createElement('tr');
      row.forEach((value, columnNumber) => {
        const td = document.createElement(rowNumber === 0 ? 'th' : 'td');
        const input = document.createElement('input');
        input.value = value;
        input.setAttribute('aria-label', `表格第 ${rowNumber + 1} 行第 ${columnNumber + 1} 列`);
        input.style.textAlign =
          table.alignments[columnNumber] === 'none' ? 'left' : table.alignments[columnNumber];
        input.addEventListener('focus', () => {
          rowIndex = rowNumber;
          columnIndex = columnNumber;
        });
        input.addEventListener('input', () => {
          table.rows[rowNumber][columnNumber] = input.value;
        });
        input.dataset.row = String(rowNumber);
        input.dataset.column = String(columnNumber);
        input.addEventListener('blur', (event) => {
          if (input.value === value) return;
          const next =
            event.relatedTarget instanceof HTMLInputElement &&
            container.contains(event.relatedTarget)
              ? { row: event.relatedTarget.dataset.row, column: event.relatedTarget.dataset.column }
              : null;
          commit();
          if (next)
            queueMicrotask(() =>
              view.dom
                .querySelector<HTMLInputElement>(
                  `[data-table-from="${container.dataset.tableFrom}"] input[data-row="${next.row}"][data-column="${next.column}"]`,
                )
                ?.focus(),
            );
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
          if (event.key === 'Escape') {
            input.value = value;
            table.rows[rowNumber][columnNumber] = value;
            input.blur();
            view.focus();
          }
        });
        td.append(input);
        tr.append(td);
      });
      grid.append(tr);
    });
    container.append(grid);
    return container;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
