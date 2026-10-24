import { EditorSelection } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { inspectFrontmatter } from './frontmatter';
import type { HeadingLevel } from './types';

export function toggleInlineFormat(view: EditorView, kind: 'bold' | 'italic'): void {
  const source = view.state.doc.toString();
  const selection = view.state.selection.main;
  const marker = kind === 'bold' ? '**' : '*';
  const nodes: { from: number; to: number; contentFrom: number; contentTo: number }[] = [];
  markdownLanguage.parser.parse(source).iterate({
    enter(node) {
      if (node.name !== (kind === 'bold' ? 'StrongEmphasis' : 'Emphasis')) return;
      const first = node.node.firstChild,
        last = node.node.lastChild;
      if (first && last)
        nodes.push({ from: node.from, to: node.to, contentFrom: first.to, contentTo: last.from });
    },
  });
  if (selection.empty) {
    const node = nodes
      .filter((node) => selection.head >= node.contentFrom && selection.head <= node.contentTo)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    if (node) {
      view.dispatch({
        changes: [
          { from: node.from, to: node.contentFrom },
          { from: node.contentTo, to: node.to },
        ],
        selection: { anchor: selection.head - (node.contentFrom - node.from) },
        userEvent: 'input.format',
        annotations: isolateHistory.of('full'),
      });
    } else {
      view.dispatch({
        changes: { from: selection.from, insert: marker + marker },
        selection: { anchor: selection.from + marker.length },
        userEvent: 'input.format',
        annotations: isolateHistory.of('full'),
      });
    }
    view.focus();
    return;
  }
  const marks = nodes
    .flatMap((node) => [
      { from: node.from, to: node.contentFrom },
      { from: node.contentTo, to: node.to },
    ])
    .sort((a, b) => a.from - b.from);
  const strip = (from: number, to: number) => {
    let text = '',
      cursor = from;
    for (const mark of marks) {
      if (mark.to <= from || mark.from >= to) continue;
      text += source.slice(cursor, Math.max(cursor, mark.from));
      cursor = Math.min(to, mark.to);
    }
    return text + source.slice(cursor, to);
  };
  let allStyled = true,
    sawText = false;
  for (let position = selection.from; position < selection.to; position++) {
    if (
      /\s/.test(source[position]) ||
      marks.some((mark) => position >= mark.from && position < mark.to)
    )
      continue;
    sawText = true;
    if (!nodes.some((node) => position >= node.contentFrom && position < node.contentTo))
      allStyled = false;
  }
  let from = selection.from,
    to = selection.to;
  for (const node of nodes) {
    if (from === node.contentFrom) from = node.from;
    if (to === node.contentTo) to = node.to;
  }
  const enabled = !(allStyled && sawText);
  const left = nodes.find((node) => from > node.contentFrom && from <= node.contentTo);
  const right = nodes.find((node) => to >= node.contentFrom && to < node.contentTo);
  const leftMarker = left ? source.slice(left.from, left.contentFrom) : marker;
  const rightMarker = right ? source.slice(right.contentTo, right.to) : marker;
  let before = '',
    after = '';
  if (enabled) {
    if (!left) before = rightMarker;
    if (!right) after = leftMarker;
    else if (left && leftMarker !== rightMarker) after = leftMarker + rightMarker;
  } else {
    if (left) before = leftMarker;
    if (right) after = rightMarker;
  }
  const insert = before + strip(from, to) + after;
  const selectedFrom = from + before.length + strip(from, selection.from).length;
  const selectedTo = selectedFrom + strip(selection.from, selection.to).length;
  view.dispatch({
    changes: { from, to, insert },
    selection:
      selection.anchor > selection.head
        ? EditorSelection.range(selectedTo, selectedFrom)
        : EditorSelection.range(selectedFrom, selectedTo),
    userEvent: 'input.format',
    annotations: isolateHistory.of('full'),
  });
  view.focus();
}

function selectedBodyLines(view: EditorView) {
  const source = view.state.doc.toString();
  const tree = markdownLanguage.parser.parse(source);
  const properties = inspectFrontmatter(source);
  const numbers = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const end =
      range.to > range.from && view.state.doc.lineAt(range.to).from === range.to
        ? range.to - 1
        : range.to;
    const last = view.state.doc.lineAt(end).number;
    for (let number = first; number <= last; number++) numbers.add(number);
  }
  return [...numbers]
    .sort((a, b) => a - b)
    .map((number) => view.state.doc.line(number))
    .filter((line) => {
      if (
        (!line.text.trim() && !view.state.selection.main.empty) ||
        (properties && line.from < properties.end)
      )
        return false;
      for (
        let node = tree.resolveInner(line.from + Math.min(1, line.length), 1);
        node.parent;
        node = node.parent
      )
        if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
      return true;
    });
}

export function setHeading(view: EditorView, level: HeadingLevel): void {
  const changes = [];
  for (const line of selectedBodyLines(view)) {
    const mark = /^( {0,3})(#{1,6})(?:[ \t]+|$)/.exec(line.text);
    const indentation = mark?.[1].length ?? /^ {0,3}/.exec(line.text)![0].length;
    const insert = level ? '#'.repeat(level) + ' ' : '';
    if (level || mark)
      changes.push({
        from: line.from + indentation,
        to: line.from + (mark?.[0].length ?? indentation),
        insert,
      });
    if (!level && mark) {
      const closing = /[ \t]+#+[ \t]*$/.exec(line.text.slice(mark[0].length));
      if (closing)
        changes.push({ from: line.from + mark[0].length + closing.index, to: line.to, insert: '' });
    }
  }
  if (changes.length)
    view.dispatch({ changes, userEvent: 'input.format', annotations: isolateHistory.of('full') });
  view.focus();
}

export function toggleLineFormat(view: EditorView, kind: 'list' | 'task' | 'quote'): void {
  const lines = selectedBodyLines(view);
  const parts = lines.map((line) => {
    const indent = /^[ \t]*/.exec(line.text)![0].length;
    const match =
      kind === 'quote'
        ? /^[ \t]*> ?/.exec(line.text)
        : /^[ \t]*([-+*]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/.exec(line.text);
    const same = Boolean(
      match &&
      (kind === 'quote' || (kind === 'task' ? match[2] : !match[2] && /^[-+*]$/.test(match[1]))),
    );
    return { line, indent, match, same };
  });
  const remove = parts.length > 0 && parts.every((part) => part.same);
  const changes = parts.flatMap(({ line, indent, match, same }) => {
    if (!remove && same) return [];
    return [
      {
        from: line.from + indent,
        to: line.from + (match?.[0].length ?? indent),
        insert: remove ? '' : kind === 'quote' ? '> ' : kind === 'task' ? '- [ ] ' : '- ',
      },
    ];
  });
  if (changes.length)
    view.dispatch({ changes, userEvent: 'input.format', annotations: isolateHistory.of('full') });
  view.focus();
}
