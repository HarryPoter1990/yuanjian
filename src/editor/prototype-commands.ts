import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { inCode, inMath, isEscaped } from './completion';

export function prototypeEnter(view: EditorView): boolean {
  if (view.composing || !view.state.selection.main.empty) return false;
  const { state } = view, position = state.selection.main.head, line = state.doc.lineAt(position);
  if (position !== line.to) return false;
  const quote = /^(\s*(?:>\s*)+)\s*$/.exec(line.text);
  if (quote) {
    const last = line.text.lastIndexOf('>');
    view.dispatch({ changes: { from: line.from + last, to: line.to }, userEvent: 'input', annotations: isolateHistory.of('full') });
    return true;
  }
  const fence = /^( {0,3})(`{3,}|~{3,})([^`~]*)$/.exec(line.text);
  const math = /^ {0,3}\$\$\s*$/.test(line.text);
  if (!fence && !math) return false;
  if (inCode(state, Math.max(line.from, position - 1))) {
    if (!fence) return false;
    let node = markdownLanguage.parser.parse(state.doc.toString()).resolveInner(line.from + 1, 1);
    while (node.parent && node.name !== 'FencedCode') node = node.parent;
    if (node.name === 'FencedCode' && node.from < line.from) return false;
  }
  const close = fence ? fence[1] + fence[2] : '$$';
  const rest = state.doc.sliceString(line.to);
  if (rest.split('\n').slice(1).some(text => text.trim() === close.trim())) return false;
  view.dispatch({ changes: { from: position, insert: '\n\n' + close }, selection: { anchor: position + 1 }, userEvent: 'input', annotations: isolateHistory.of('full') });
  return true;
}

export function prototypeDollarBackspace(view: EditorView): boolean {
  const { state } = view, p = state.selection.main.head;
  if (view.composing || !state.selection.main.empty || inCode(state, p) ||
      state.doc.sliceString(p - 1, p + 1) !== '$$') return false;
  const line = state.doc.lineAt(p);
  if (isEscaped(line.text, p - line.from - 1) || inMath(state, p - 1)) return false;
  view.dispatch({ changes: { from: p - 1, to: p + 1 }, userEvent: 'delete.backward' });
  return true;
}

export function prototypeListIndent(view: EditorView, out = false): boolean {
  if (view.composing) return false;
  const { state } = view, range = state.selection.main;
  const first = state.doc.lineAt(range.from), last = state.doc.lineAt(Math.max(range.from, range.to - (range.to > range.from ? 1 : 0)));
  const marker = /^( *)(?:[-+*]|\d+[.)])[ \t]+/;
  const current = marker.exec(first.text);
  if (!current || inCode(state, range.head)) return false;
  let width = 2;
  for (let n = first.number - 1; n > 0; n--) {
    const parent = marker.exec(state.doc.line(n).text);
    if (parent && parent[1].length <= current[1].length) { width = parent[0].length - parent[1].length; break; }
    if (state.doc.line(n).text.trim() && !/^\s/.test(state.doc.line(n).text)) break;
  }
  let end = last.number;
  if (range.empty) while (end < state.doc.lines) {
    const next = state.doc.line(end + 1);
    if (!next.text.trim() || /^ */.exec(next.text)![0].length <= current[1].length) break;
    end++;
  }
  if (out) {
    let parentIndent = 0;
    for (let n = first.number - 1; n > 0; n--) {
      const m = marker.exec(state.doc.line(n).text);
      if (m && m[1].length < current[1].length) { parentIndent = m[1].length; break; }
    }
    width = Math.max(0, current[1].length - parentIndent);
  } else if (!first.number || first.number === 1) return false;
  if (!width) return out;
  const changes = [];
  for (let n = first.number; n <= end; n++) {
    const line = state.doc.line(n);
    changes.push(out ? { from: line.from, to: line.from + Math.min(width, /^ */.exec(line.text)![0].length) } : { from: line.from, insert: ' '.repeat(width) });
  }
  view.dispatch({ changes, userEvent: 'input.indent', annotations: isolateHistory.of('full') });
  return true;
}
