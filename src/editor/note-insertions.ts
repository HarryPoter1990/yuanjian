import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { inCode, inMath } from './completion';

export const noteInsertions = [
  {
    command: 'callout',
    label: '信息提示块',
    text: '> [!info] 提示\n> 补充说明',
    select: '补充说明',
    block: true,
  },
  {
    command: 'foldCallout',
    label: '折叠提示块',
    text: '> [!tip]- 展开查看\n> 补充说明',
    select: '补充说明',
    block: true,
  },
  {
    command: 'highlight',
    label: '高亮',
    text: '==重点==',
    select: '重点',
    marker: '==',
    block: false,
  },
  { command: 'superscript', label: '上标', text: '^2^', select: '2', marker: '^', block: false },
  { command: 'subscript', label: '下标', text: '~2~', select: '2', marker: '~', block: false },
  {
    command: 'comment',
    label: '隐藏注释',
    text: '%%补充备注%%',
    select: '补充备注',
    marker: '%%',
    block: false,
  },
  { command: 'toc', label: '文章目录', text: '[TOC]', select: '', block: true },
  {
    command: 'imageEmbed',
    label: '图片嵌入',
    text: '![[图片.png|480]]',
    select: '图片.png',
    block: true,
  },
  { command: 'noteEmbed', label: '笔记嵌入', text: '![[笔记名]]', select: '笔记名', block: true },
  {
    command: 'blockEmbed',
    label: '段落嵌入',
    text: '![[笔记名#^块标识]]',
    select: '笔记名#^块标识',
    block: true,
  },
  {
    command: 'details',
    label: '可折叠区域',
    text: '<details>\n<summary>展开查看</summary>\n\n补充说明\n\n</details>',
    select: '补充说明',
    block: true,
  },
  {
    command: 'footnote',
    label: '脚注',
    text: '正文[^注]\n\n[^注]: 补充说明',
    select: '补充说明',
    block: true,
  },
] as const;
export type NoteInsertionCommand = (typeof noteInsertions)[number]['command'];

export function insertNoteSyntax(view: EditorView, command: string): boolean {
  const entry = noteInsertions.find((item) => item.command === command);
  if (!entry) return false;
  const { state } = view,
    selection = state.selection.main,
    source = state.doc.toString();
  if (inCode(state, selection.from) || inMath(state, selection.from)) return false;
  const selected = state.sliceDoc(selection.from, selection.to);
  let text: string = entry.text,
    placeholder: string = entry.select;
  if ('marker' in entry && selected) {
    if (selected.includes('\n') && command !== 'comment') return false;
    const marker = entry.marker,
      size = marker.length;
    const enclosed =
      state.sliceDoc(Math.max(0, selection.from - size), selection.from) === marker &&
      state.sliceDoc(selection.to, selection.to + size) === marker;
    if (
      enclosed ||
      (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= size * 2)
    ) {
      const from = enclosed ? selection.from - size : selection.from,
        to = enclosed ? selection.to + size : selection.to;
      const body = enclosed ? selected : selected.slice(size, -size);
      view.dispatch({
        changes: { from, to, insert: body },
        selection: { anchor: from, head: from + body.length },
        annotations: isolateHistory.of('full'),
        userEvent: 'input.format',
      });
      view.focus();
      return true;
    }
    text = marker + selected + marker;
    placeholder = selected;
  } else if ((command === 'callout' || command === 'foldCallout') && selected) {
    text =
      (command === 'callout' ? '> [!info] 提示\n' : '> [!tip]- 展开查看\n') +
      selected
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n');
    placeholder = '';
  } else if (command === 'details' && selected) {
    text = text.replace('补充说明', selected);
    placeholder = '';
  }
  if (command === 'footnote') {
    let label = '注',
      n = 1;
    while (source.includes(`[^${label}]`)) label = `注${++n}`;
    text = text.replaceAll('[^注]', `[^${label}]`);
    if (selected) text = text.replace('正文', selected);
  }
  const before =
    entry.block && selection.from !== state.doc.lineAt(selection.from).from ? '\n\n' : '';
  const after = entry.block ? '\n\n' : '';
  const offset = before.length + (placeholder ? text.indexOf(placeholder) : text.length);
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: before + text + after },
    selection: {
      anchor: selection.from + offset,
      head: selection.from + offset + placeholder.length,
    },
    annotations: isolateHistory.of('full'),
    userEvent: 'input.insert',
  });
  view.focus();
  return true;
}
