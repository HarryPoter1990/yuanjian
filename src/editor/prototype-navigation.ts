import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { livePreviewField, previewConfig } from './live-preview';
import { prototypeMathRanges } from './prototype-preview';

export function prototypeVertical(view: EditorView, forward: boolean, extend = false): boolean {
  if (view.composing || view.state.facet(previewConfig).mode !== 'live') return false;
  const { state } = view,
    selection = state.selection.main,
    line = state.doc.lineAt(selection.head);
  if (!selection.empty && !extend) return false;
  const moved = view.moveVertically(selection, forward);
  if (state.doc.lineAt(moved.head).number === line.number) return false;
  const blocks = state
    .field(livePreviewField)
    .blocks.filter((b) => ['fence', 'block_math', 'table_open'].includes(b.type));
  const current = blocks.find(
    (b) => b.type !== 'table_open' && selection.head >= b.from && selection.head <= b.to,
  );
  let targetLine = line.number + (forward ? 1 : -1);
  const column = selection.head - line.from;
  const select = (number: number) => {
    if (number < 1 || number > state.doc.lines) return true;
    const target = state.doc.line(number),
      head = target.from + Math.min(column, target.length);
    view.dispatch({
      selection: extend
        ? EditorSelection.range(selection.anchor, head)
        : EditorSelection.cursor(head),
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  };
  if (current) {
    const first = state.doc.lineAt(current.from).number,
      last = state.doc.lineAt(current.to).number;
    if ((!forward && line.number === first + 1) || (forward && line.number === last - 1))
      return select(forward ? last + 1 : first - 1);
    return false;
  }
  if (targetLine < 1 || targetLine > state.doc.lines) return false;
  const next = blocks.find(
    (b) =>
      targetLine >= state.doc.lineAt(b.from).number && targetLine <= state.doc.lineAt(b.to).number,
  );
  if (!next) return false;
  if (next.type === 'table_open' && !extend) {
    const grid = view.dom.querySelector<HTMLElement>(`[data-table-from="${next.from}"]`);
    const cells = [...(grid?.querySelectorAll<HTMLTextAreaElement>('textarea[data-row]') ?? [])];
    if (!cells.length) return false;
    const row = forward ? 0 : Math.max(...cells.map((c) => Number(c.dataset.row)));
    const x = view.coordsAtPos(selection.head)?.left ?? cells[0].getBoundingClientRect().left;
    const cell = cells
      .filter((c) => Number(c.dataset.row) === row)
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(),
          rb = b.getBoundingClientRect();
        return Math.abs(ra.left + ra.width / 2 - x) - Math.abs(rb.left + rb.width / 2 - x);
      })[0];
    cell.focus({ preventScroll: true });
    cell.setSelectionRange(forward ? 0 : cell.value.length, forward ? 0 : cell.value.length);
    return true;
  }
  const first = state.doc.lineAt(next.from).number,
    last = state.doc.lineAt(next.to).number;
  targetLine =
    next.type === 'table_open'
      ? forward
        ? first
        : last
      : forward
        ? Math.min(first + 1, last)
        : Math.max(last - 1, first);
  return select(targetLine);
}

export function prototypeHorizontal(view: EditorView, forward: boolean): boolean {
  const { state } = view,
    p = state.selection.main.head;
  if (view.composing || !state.selection.main.empty || state.facet(previewConfig).mode !== 'live')
    return false;
  const target = p + (forward ? 1 : -1);
  if (
    !prototypeMathRanges(state).some(
      (r) => target >= r.from && target <= r.to && (p <= r.from || p >= r.to),
    )
  )
    return false;
  view.dispatch({ selection: { anchor: target }, userEvent: 'select' });
  return true;
}
