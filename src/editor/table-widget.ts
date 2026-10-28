import { WidgetType, type EditorView } from '@codemirror/view';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { parseTable, serializeTable, tableCellChange, type Alignment } from './table';
import { decodeTableCellBreaks } from './table-cell';
import { clipboardMatrix, planMatrixPaste } from './table-paste';
import { convertRichText } from './clipboard';

const gridStates = new WeakMap<HTMLElement, { update(source: string): boolean; destroy(): void }>();

function cellAtVisualEdge(input: HTMLTextAreaElement, down: boolean): boolean {
  const p = input.selectionStart;
  if (p !== input.selectionEnd) return false;
  const style = getComputedStyle(input),
    mirror = document.createElement('div');
  for (const key of [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'boxSizing',
    'textIndent',
    'tabSize',
  ] as const)
    mirror.style[key] = style[key];
  Object.assign(mirror.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    visibility: 'hidden',
    width: `${input.getBoundingClientRect().width}px`,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    borderStyle: 'solid',
  });
  const start = document.createElement('span'),
    caret = document.createElement('span'),
    end = document.createElement('span');
  start.textContent = caret.textContent = end.textContent = '\u200b';
  mirror.append(
    start,
    document.createTextNode(input.value.slice(0, p)),
    caret,
    document.createTextNode(input.value.slice(p)),
    end,
  );
  document.body.append(mirror);
  try {
    const y = caret.getBoundingClientRect().top,
      edge = (down ? end : start).getBoundingClientRect().top;
    const tolerance = Math.max(1, (parseFloat(style.lineHeight) || 20) / 4);
    return down ? y >= edge - tolerance : y <= edge + tolerance;
  } finally {
    mirror.remove();
  }
}

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly to: number,
    readonly prototypeEditing = false,
  ) {
    super();
  }
  eq(other: TableWidget): boolean {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.to === other.to &&
      this.prototypeEditing === other.prototypeEditing
    );
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
    const inputs: HTMLTextAreaElement[][] = [];
    let pending: { source: string; rows: string[][]; row: number; column: number } | null = null;
    const confirmation = document.createElement('div');
    confirmation.className = 'table-paste-confirm';
    confirmation.setAttribute('role', 'alertdialog');
    confirmation.setAttribute('aria-label', '确认覆盖表格内容');
    confirmation.hidden = true;
    const notice = (message: string, error = false) =>
      container.dispatchEvent(
        new CustomEvent('yuanjian:editor-notice', { bubbles: true, detail: { message, error } }),
      );
    const resizeCell = (input: HTMLTextAreaElement) => {
      input.style.height = 'auto';
      input.rows = Math.max(1, input.value.split('\n').length);
      if (input.scrollHeight) input.style.height = `${input.scrollHeight}px`;
    };
    const resizeAll = () => {
      if (!container.isConnected) return;
      const cells = inputs.flat();
      cells.forEach((input) => {
        input.style.height = 'auto';
      });
      const heights = cells.map((input) => input.scrollHeight);
      cells.forEach((input, index) => {
        if (heights[index]) input.style.height = `${heights[index]}px`;
      });
    };
    let lastWidth = -1;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width;
            if (width !== undefined && width !== lastWidth) {
              lastWidth = width;
              resizeAll();
            }
          });
    const focusCell = (r: number, c: number) =>
      queueMicrotask(() => {
        if (!view.dom.isConnected) return;
        const widget = view.dom.querySelector<HTMLElement>(
          `[data-table-from="${container.dataset.tableFrom}"]`,
        );
        const target =
          widget?.querySelector<HTMLTextAreaElement>(`[data-row="${r}"][data-column="${c}"]`) ??
          [...(widget?.querySelectorAll<HTMLTextAreaElement>('textarea[data-row]') ?? [])].at(-1);
        if (target) target.focus({ preventScroll: true });
        else view.focus();
      });
    const cancelConfirmation = (focus = true) => {
      const previous = pending;
      pending = null;
      confirmation.hidden = true;
      confirmation.replaceChildren();
      confirmation.remove();
      if (focus && previous) focusCell(previous.row, previous.column);
    };
    gridStates.set(container, {
      update(source) {
        if (pending && source !== pending.source) {
          cancelConfirmation(false);
          notice('表格已变化，本次待确认粘贴已取消，请重新粘贴。');
        }
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
            const value = decodeTableCellBreaks(table.rows[r][c]);
            if (input.value !== value) {
              input.value = value;
              resizeCell(input);
            }
            input.style.textAlign = table.alignments[c] === 'none' ? 'left' : table.alignments[c];
          }),
        );
        return true;
      },
      destroy() {
        observer?.disconnect();
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
            .querySelector<HTMLTextAreaElement>(
              `[data-table-from="${from}"] [data-row="${Math.min(rowIndex, table.rows.length - 1)}"][data-column="${Math.min(columnIndex, table.alignments.length - 1)}"]`,
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
    action('复制整表', () => {
      const from = Number(container.dataset.tableFrom),
        to = Number(container.dataset.tableTo);
      if (view.state.doc.sliceString(from, to) !== currentSource) return;
      container.dispatchEvent(
        new CustomEvent('yuanjian:copy-table', {
          bubbles: true,
          detail: { from, to, source: currentSource },
        }),
      );
    });
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
    const applyMatrix = (rows: string[][], r: number, c: number, expected: string) => {
      if (!container.isConnected || !view.dom.isConnected) return;
      const from = Number(container.dataset.tableFrom),
        to = Number(container.dataset.tableTo);
      if (expected !== currentSource || view.state.doc.sliceString(from, to) !== expected) {
        notice('表格已变化，请重新粘贴。', true);
        return;
      }
      const plan = planMatrixPaste(expected, r, c, rows);
      if (!plan) return;
      cancelConfirmation(false);
      view.dispatch({
        changes: { from, to, insert: plan.source },
        userEvent: 'input.table.paste',
        annotations: isolateHistory.of('full'),
      });
      focusCell(r, c);
    };
    const pasteIntoCell = (
      input: HTMLTextAreaElement,
      r: number,
      c: number,
      html: string,
      plain: string,
      plainOnly = false,
    ) => {
      try {
        const matrix = plainOnly ? null : clipboardMatrix(html, plain);
        if (matrix) {
          const plan = planMatrixPaste(currentSource, r, c, matrix.rows);
          if (!plan) return;
          matrix.notices.forEach((message) => notice(message));
          if (!plan.overwrite) {
            applyMatrix(matrix.rows, r, c, currentSource);
            return;
          }
          cancelConfirmation(false);
          const request = { source: currentSource, rows: matrix.rows, row: r, column: c };
          pending = request;
          const text = document.createElement('p');
          text.textContent = `将覆盖 ${plan.overwrite} 个非空单元格，是否继续？`;
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = '取消';
          cancel.addEventListener('click', () => cancelConfirmation());
          const accept = document.createElement('button');
          accept.type = 'button';
          accept.textContent = '覆盖并粘贴';
          accept.addEventListener('click', () => {
            if (pending === request)
              applyMatrix(request.rows, request.row, request.column, request.source);
          });
          confirmation.replaceChildren(text, cancel, accept);
          confirmation.hidden = false;
          container.insertBefore(confirmation, scroll);
          cancel.focus();
          return;
        }
        const converted =
          html && !plainOnly
            ? convertRichText(html, plain, true)
            : { markdown: plain, notices: [] };
        converted.notices.forEach((message) => notice(message));
        if (!converted.markdown) return;
        input.setRangeText(
          converted.markdown.replace(/\r\n?/g, '\n'),
          input.selectionStart ?? 0,
          input.selectionEnd ?? 0,
          'end',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      } catch (reason) {
        notice(
          `表格粘贴未完成：${reason instanceof Error ? reason.message : String(reason)}`,
          true,
        );
      }
    };
    confirmation.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelConfirmation();
      }
    });
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    const grid = document.createElement('table');
    grid.style.minWidth = `${table.alignments.length * 128}px`;
    table.rows.forEach((row, rowNumber) => {
      inputs[rowNumber] = [];
      const tr = document.createElement('tr');
      row.forEach((value, columnNumber) => {
        const td = document.createElement(rowNumber === 0 ? 'th' : 'td');
        const input = document.createElement('textarea');
        input.value = decodeTableCellBreaks(value);
        resizeCell(input);
        let originalValue = input.value;
        let plainPaste = false;
        input.setAttribute('aria-label', `表格第 ${rowNumber + 1} 行第 ${columnNumber + 1} 列`);
        input.style.textAlign =
          table.alignments[columnNumber] === 'none' ? 'left' : table.alignments[columnNumber];
        input.addEventListener('focus', () => {
          rowIndex = rowNumber;
          columnIndex = columnNumber;
          originalValue = input.value;
        });
        const writeCell = () => {
          const from = Number(container.dataset.tableFrom);
          const to = Number(container.dataset.tableTo);
          if (view.state.doc.sliceString(from, to) !== currentSource) return;
          const change = tableCellChange(currentSource, rowNumber, columnNumber, input.value);
          if (!change) return;
          table.rows[rowNumber][columnNumber] = input.value;
          resizeCell(input);
          if (currentSource.slice(change.from, change.to) === change.insert) return;
          currentSource =
            currentSource.slice(0, change.from) + change.insert + currentSource.slice(change.to);
          view.dispatch({
            changes: { from: from + change.from, to: from + change.to, insert: change.insert },
            userEvent: 'input.table',
          });
        };
        input.addEventListener('input', writeCell);
        input.addEventListener('paste', (event) => {
          if (!event.clipboardData) return;
          const html = event.clipboardData.getData('text/html'),
            plain = event.clipboardData.getData('text/plain');
          const usePlain = plainPaste;
          plainPaste = false;
          if (!html && !plain) return;
          event.preventDefault();
          event.stopPropagation();
          pasteIntoCell(input, rowNumber, columnNumber, html, plain, usePlain);
        });
        input.addEventListener('yuanjian:paste-cell', (event) => {
          event.stopPropagation();
          const detail: unknown = (event as CustomEvent).detail;
          if (
            !detail ||
            typeof detail !== 'object' ||
            !('html' in detail) ||
            !('plain' in detail) ||
            typeof detail.html !== 'string' ||
            typeof detail.plain !== 'string'
          )
            return;
          pasteIntoCell(
            input,
            rowNumber,
            columnNumber,
            detail.html,
            detail.plain,
            'plainOnly' in detail && detail.plainOnly === true,
          );
        });
        input.dataset.row = String(rowNumber);
        input.dataset.column = String(columnNumber);
        input.addEventListener('keydown', (event) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (
            this.prototypeEditing &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            ['ArrowUp', 'ArrowDown'].includes(event.key)
          ) {
            const p = input.selectionStart,
              q = input.selectionEnd,
              down = event.key === 'ArrowDown';
            const atEdge = p === q && cellAtVisualEdge(input, down);
            if (atEdge) {
              event.preventDefault();
              event.stopPropagation();
              const targetRow = rowNumber + (down ? 1 : -1);
              const cell = inputs[targetRow]?.[columnNumber];
              if (cell) {
                cell.focus({ preventScroll: true });
                const target = down
                  ? Math.min(
                      p,
                      cell.value.indexOf('\n') < 0 ? cell.value.length : cell.value.indexOf('\n'),
                    )
                  : cell.value.lastIndexOf('\n') +
                    1 +
                    Math.min(p, cell.value.length - cell.value.lastIndexOf('\n') - 1);
                cell.setSelectionRange(target, target);
              } else {
                const edge = Number(down ? container.dataset.tableTo : container.dataset.tableFrom);
                const number = view.state.doc.lineAt(edge).number + (down ? 1 : -1);
                if (number >= 1 && number <= view.state.doc.lines) {
                  const line = view.state.doc.line(number);
                  view.dispatch({
                    selection: { anchor: line.from + Math.min(p, line.length) },
                    scrollIntoView: true,
                    userEvent: 'select',
                  });
                  view.focus();
                }
              }
              return;
            }
          }
          if (
            (event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            ['z', 'y'].includes(event.key.toLowerCase())
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key.toLowerCase() === 'y' || event.shiftKey) redo(view);
            else undo(view);
            focusCell(rowNumber, columnNumber);
            return;
          }
          plainPaste =
            (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && event.shiftKey;
          if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const columns = table.alignments.length;
            const next = rowNumber * columns + columnNumber + (event.shiftKey ? -1 : 1);
            if (next < 0) return;
            event.preventDefault();
            if (next < table.rows.length * columns) {
              inputs[Math.floor(next / columns)][next % columns].focus();
            } else {
              const from = Number(container.dataset.tableFrom);
              const to = Number(container.dataset.tableTo);
              if (view.state.doc.sliceString(from, to) !== currentSource) return;
              view.dispatch({
                changes: { from: to, insert: '\n| ' + Array(columns).fill('').join(' | ') + ' |' },
                userEvent: 'input.table',
              });
              queueMicrotask(() =>
                view.dom
                  .querySelector<HTMLTextAreaElement>(
                    `[data-table-from="${from}"] [data-row="${table.rows.length}"][data-column="0"]`,
                  )
                  ?.focus(),
              );
            }
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) {
              input.setRangeText('\n', input.selectionStart ?? 0, input.selectionEnd ?? 0, 'end');
              writeCell();
            } else input.blur();
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
    observer?.observe(scroll);
    queueMicrotask(resizeAll);
    return container;
  }
  destroy(dom: HTMLElement): void {
    gridStates.get(dom)?.destroy();
    gridStates.delete(dom);
  }
  ignoreEvent(): boolean {
    return true;
  }
}
