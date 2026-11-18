import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  countColumn,
  findColumn,
  type ChangeSpec,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentUnit, syntaxTree } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { insertNewlineAndIndent, isolateHistory } from '@codemirror/commands';
import { acceptCompletion, nextSnippetField, prevSnippetField } from '@codemirror/autocomplete';
import type { Settings } from '../shared/types';
import type { SyntaxNode } from '@lezer/common';

function codeBlock(state: EditorState, position: number): SyntaxNode | null {
  const line = state.doc.lineAt(position);
  for (let node = syntaxTree(state).resolve(line.to, -1); node;) {
    if (node.name === 'CodeBlock') return node;
    if (node.name === 'FencedCode') {
      const opening = state.doc.lineAt(node.from);
      const closing = node.lastChild;
      return line.number > opening.number &&
        !(closing?.name === 'CodeMark' && state.doc.lineAt(closing.from).number === line.number)
        ? node
        : null;
    }
    if (!node.parent) break;
    node = node.parent;
  }
  return null;
}
function containerPrefix(state: EditorState, position: number): string {
  const block = codeBlock(state, position);
  if (!block || (block.name === 'FencedCode' && block.parent?.name === 'Document')) return '';
  const opening = state.doc.lineAt(block.from),
    line = state.doc.lineAt(position);
  // A list marker on the opening line becomes whitespace on its continuation lines.
  const prefix = opening.text.slice(0, block.from - opening.from).replace(/[^>\t ]/g, ' ');
  if (line.text.startsWith(prefix)) return prefix;
  const quoteCount = prefix.split('>').length - 1;
  const quote = quoteCount
    ? (new RegExp(`^(?:[\\t ]*>){${quoteCount}}`).exec(line.text)?.[0] ?? '')
    : '';
  const remainder = /^[\t ]*/.exec(line.text.slice(quote.length))![0];
  const columns = countColumn(prefix.slice(prefix.lastIndexOf('>') + 1), 4);
  return quote + remainder.slice(0, findColumn(remainder, columns, 4));
}
function codeSelection(state: EditorState): boolean {
  return state.selection.ranges.every((range) => {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
      const line = state.doc.line(n);
      if (!range.empty && line.from === range.to) break;
      if (!codeBlock(state, Math.max(line.from, Math.min(range.from, line.to)))) return false;
    }
    return true;
  });
}
function codeLiteral(state: EditorState, position: number): boolean {
  for (let node = syntaxTree(state).resolveInner(position, -1); node;) {
    if (/String|Comment|RegExp/.test(node.name)) return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}
function whitespace(columns: number, width: number, tabs: boolean): string {
  return tabs
    ? '\t'.repeat(Math.floor(columns / width)) + ' '.repeat(columns % width)
    : ' '.repeat(columns);
}
function indentLines(
  view: EditorView,
  width: number,
  tabs: boolean,
  out: boolean,
  code = false,
): boolean {
  const { state } = view;
  if (state.readOnly || view.composing) return false;
  const lines = new Set<number>();
  for (const range of state.selection.ranges)
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
      if (!range.empty && state.doc.line(n).from === range.to) break;
      lines.add(n);
    }
  const changes: ChangeSpec[] = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    const base = code || out ? containerPrefix(state, line.from) : '';
    const prefix = /^[\t ]*/.exec(line.text.slice(base.length))![0];
    const columns = countColumn(prefix, state.tabSize);
    const next = whitespace(Math.max(0, columns + (out ? -width : width)), width, tabs);
    if (prefix !== next)
      changes.push({
        from: line.from + base.length,
        to: line.from + base.length + prefix.length,
        insert: next,
      });
  }
  const changeSet = state.changes(changes);
  view.dispatch({
    changes: changeSet,
    selection: state.selection.map(changeSet, 1),
    userEvent: 'input.indent',
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  });
  return true;
}
// Preserve the old two-space fallback outside code; list/snippet handlers still run first.
export function ordinaryIndent(view: EditorView, out = false): boolean {
  return indentLines(view, 2, false, out);
}

export function codeIndentation(settings: Settings): Extension {
  const width = settings.codeIndentSize ?? 4;
  const tabs = settings.codeIndentStyle === 'tabs';
  const auto = settings.codeAutoIndent !== false;
  const enter = (view: EditorView) => {
    const { state } = view;
    if (view.composing || state.readOnly || !codeSelection(state)) return false;
    if (
      auto &&
      state.selection.ranges.every(
        (range) =>
          !markdownLanguage.isActiveAt(state, range.head) && !codeLiteral(state, range.head),
      )
    )
      return insertNewlineAndIndent({
        state,
        dispatch(transaction) {
          const prefixes: ChangeSpec[] = [];
          transaction.changes.iterChanges((from, _to, fromB, _toB, text) => {
            const prefix = containerPrefix(state, from);
            if (prefix.includes('>'))
              for (const match of text.toString().matchAll(/\n/g))
                prefixes.push({ from: fromB + match.index! + 1, insert: prefix });
          });
          const extra = ChangeSet.of(prefixes, transaction.newDoc.length);
          view.dispatch({
            changes: transaction.changes.compose(extra),
            selection: transaction.newSelection.map(extra, 1),
            userEvent: 'input',
          });
        },
      });
    view.dispatch(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from);
        const base = containerPrefix(state, range.from);
        const prefix =
          base +
          (auto ? /^[\t ]*/.exec(state.sliceDoc(line.from + base.length, range.from))![0] : '');
        const insert = '\n' + prefix;
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        };
      }),
      { userEvent: 'input' },
    );
    return true;
  };
  const tab = (view: EditorView, out = false) => {
    const { state } = view;
    if (state.readOnly || view.composing || !codeSelection(state)) return false;
    if (out ? prevSnippetField(view) : nextSnippetField(view) || acceptCompletion(view))
      return true;
    if (out || state.selection.ranges.some((range) => !range.empty))
      return indentLines(view, width, tabs, out, true);
    view.dispatch(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.head);
        const start = line.from + containerPrefix(state, range.head).length;
        const from = Math.max(range.head, start);
        const column = countColumn(state.sliceDoc(start, from), width);
        const insert = tabs ? '\t' : ' '.repeat(width - (column % width));
        return {
          changes: { from, insert },
          range: EditorSelection.cursor(from + insert.length),
        };
      }),
      { userEvent: 'input.indent', annotations: isolateHistory.of('full') },
    );
    return true;
  };
  const backspace = (view: EditorView) => {
    const { state } = view;
    if (
      view.composing ||
      state.readOnly ||
      !codeSelection(state) ||
      state.selection.ranges.some((range) => !range.empty)
    )
      return false;
    if (
      !state.selection.ranges.every((range) => {
        const base = containerPrefix(state, range.head);
        const from = state.doc.lineAt(range.head).from + base.length;
        return (
          (range.head > from && /^[\t ]*$/.test(state.sliceDoc(from, range.head))) ||
          (range.head <= from && base.length > 0)
        );
      })
    )
      return false;
    view.dispatch(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.head);
        const from = line.from + containerPrefix(state, range.head).length;
        if (range.head <= from) return { range };
        const columns = countColumn(state.sliceDoc(from, range.head), width);
        const insert = whitespace(
          Math.max(0, Math.floor((columns - 1) / width) * width),
          width,
          tabs,
        );
        return {
          changes: { from, to: range.head, insert },
          range: EditorSelection.cursor(from + insert.length),
        };
      }),
      { userEvent: 'delete.backward', annotations: isolateHistory.of('full') },
    );
    return true;
  };
  return [
    indentUnit.of(tabs ? '\t' : ' '.repeat(width)),
    EditorState.tabSize.of(width),
    Prec.high(
      keymap.of([
        { key: 'Enter', run: enter },
        { key: 'Tab', run: (view) => tab(view), shift: (view) => tab(view, true) },
        { key: 'Backspace', run: backspace },
      ]),
    ),
  ];
}
