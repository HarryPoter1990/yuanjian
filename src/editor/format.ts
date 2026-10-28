import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type TransactionSpec,
} from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { inspectFrontmatter } from './frontmatter';
import type { HeadingLevel } from './types';
import { createMarkdownParser } from './renderer';

export function toggleInlineFormat(view: EditorView, kind: 'bold' | 'italic'): void {
  const { state } = view;
  const selection = state.selection.main;
  if (selection.empty || !state.sliceDoc(selection.from, selection.to).includes('\n')) {
    view.dispatch(inlineFormatSpec(state, kind, selection));
  } else {
    const source = state.doc.toString();
    const properties = inspectFrontmatter(source);
    const ranges = createMarkdownParser()
      .parse(source, {})
      .flatMap((token) => {
        if (token.type !== 'inline' || !token.map || !token.content.trim()) return [];
        const first = state.doc.line(token.map[0] + 1),
          last = state.doc.line(token.map[1]);
        if (properties && first.from < properties.end) return [];
        const parts = token.content.split('\n');
        const start = first.text.lastIndexOf(parts[0]),
          end = last.text.lastIndexOf(parts.at(-1)!);
        if (start < 0 || end < 0) return [];
        const from = Math.max(selection.from, first.from + start),
          to = Math.min(selection.to, last.from + end + parts.at(-1)!.length);
        return from < to ? [EditorSelection.range(from, to)] : [];
      });
    const tree = markdownLanguage.parser.parse(source);
    const target = kind === 'bold' ? 'StrongEmphasis' : 'Emphasis';
    const enabled = !ranges.every((range) => {
      for (let pos = range.from; pos < range.to; pos++) {
        if (/\s/.test(source[pos])) continue;
        let node = tree.resolveInner(pos, 1);
        while (node.parent && node.name !== target) node = node.parent;
        if (node.name !== target) return false;
      }
      return true;
    });
    const changes = ranges.flatMap((range) => {
      const spec = inlineFormatSpec(state, kind, range, enabled);
      return spec.changes ? [state.changes(spec.changes)] : [];
    });
    if (changes.length) {
      const combined = state.changes(changes);
      view.dispatch({
        changes: combined,
        selection: EditorSelection.range(
          combined.mapPos(selection.anchor, selection.anchor === selection.from ? -1 : 1),
          combined.mapPos(selection.head, selection.head === selection.from ? -1 : 1),
        ),
        userEvent: 'input.format',
        annotations: isolateHistory.of('full'),
      });
    }
  }
  view.focus();
}
function inlineFormatSpec(
  state: EditorState,
  kind: 'bold' | 'italic',
  selection: SelectionRange,
  force?: boolean,
): TransactionSpec {
  const source = state.doc.toString();
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
      return {
        changes: [
          { from: node.from, to: node.contentFrom },
          { from: node.contentTo, to: node.to },
        ],
        selection: { anchor: selection.head - (node.contentFrom - node.from) },
        userEvent: 'input.format',
        annotations: isolateHistory.of('full'),
      };
    } else {
      return {
        changes: { from: selection.from, insert: marker + marker },
        selection: { anchor: selection.from + marker.length },
        userEvent: 'input.format',
        annotations: isolateHistory.of('full'),
      };
    }
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
  const enabled = force ?? !(allStyled && sawText);
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
  return {
    changes: { from, to, insert },
    selection:
      selection.anchor > selection.head
        ? EditorSelection.range(selectedTo, selectedFrom)
        : EditorSelection.range(selectedFrom, selectedTo),
    userEvent: 'input.format',
    annotations: isolateHistory.of('full'),
  };
}

function selectedBodyLines(view: EditorView, protectMath = false) {
  const source = view.state.doc.toString();
  const tree = markdownLanguage.parser.parse(source);
  const properties = inspectFrontmatter(source);
  const math = protectMath
    ? createMarkdownParser()
        .parse(source, {})
        .filter((token) => token.type === 'block_math' && token.map)
        .map((token) => token.map!)
    : [];
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
        math.some(([from, to]) => line.number > from && line.number <= to) ||
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

export function setHeading(view: EditorView, level: HeadingLevel, protectMath = false): void {
  const changes = [];
  for (const line of selectedBodyLines(view, protectMath)) {
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

export function toggleLineFormat(
  view: EditorView,
  kind: 'list' | 'task' | 'quote',
  protectMath = false,
): void {
  const lines = selectedBodyLines(view, protectMath);
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
