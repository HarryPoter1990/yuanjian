import { undo, redo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { createPortal } from 'react-dom';
import { DropdownMenu } from '../components/Controls';
import { sourcePositionAtPoint } from './live-preview';
import { selectedCopy, writeCopy, type CopyContent } from './clipboard-output';

const shortcuts: Record<string, string> = {
  撤销: 'Ctrl+Z',
  重做: 'Ctrl+Y',
  剪切: 'Ctrl+X',
  复制: 'Ctrl+C',
  粘贴: 'Ctrl+V',
  粘贴为纯文本: 'Ctrl+Shift+V',
  全选: 'Ctrl+A',
};

export interface EditorMenuState {
  left: number;
  top: number;
  kind: 'text' | 'code' | 'table';
  input?: HTMLInputElement | HTMLTextAreaElement;
  code?: { source: string; from: number };
  nativeText: string;
  readOnly: boolean;
  copy: CopyContent | null;
}

export function editorMenuAt(view: EditorView, event: MouseEvent): EditorMenuState | null {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !view.contentDOM.contains(target)) return null;
  const input =
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    target.closest('.markdown-table-widget')
      ? target
      : undefined;
  if (!input && target.closest('input,textarea,button,select,summary')) return null;
  const selection = view.dom.ownerDocument.getSelection();
  const copyData = selectedCopy(view);
  let readOnly = Boolean(copyData && !copyData.range);
  if (!input && !copyData && view.state.selection.main.empty && !readOnly) {
    const position =
      sourcePositionAtPoint(view, event) ??
      (!target.closest('.markdown-preview-block')
        ? view.state.doc.length === 0
          ? 0
          : view.posAtCoords({ x: event.clientX, y: event.clientY })
        : null);
    if (position !== null) view.dispatch({ selection: { anchor: position } });
    else readOnly = true;
  }
  const preview = target.closest<HTMLElement>('.markdown-preview-block');
  const copy = target.closest('.code-container')?.querySelector<HTMLButtonElement>('.code-copy');
  const code =
    copy && preview
      ? {
          source: decodeURIComponent(copy.dataset.code ?? ''),
          from: Number(preview.dataset.sourceFrom),
        }
      : undefined;
  return {
    left: Math.max(8, Math.min(event.clientX, window.innerWidth - 228)),
    top: Math.max(8, Math.min(event.clientY, window.innerHeight - 300)),
    kind: input ? 'table' : code ? 'code' : 'text',
    input,
    code,
    nativeText: selection?.toString() ?? '',
    readOnly,
    copy: copyData,
  };
}

export function EditorContextMenu({
  state,
  view,
  onClose,
  onError,
  pastePlain,
  pasteRich,
}: {
  state: EditorMenuState;
  view: EditorView;
  onClose(): void;
  onError(message: string): void;
  pastePlain(): void;
  pasteRich(): void;
}) {
  const copyText = (text: string) => navigator.clipboard.writeText(text);
  const run = (action: () => void | Promise<void>) => {
    onClose();
    Promise.resolve()
      .then(() => {
        if (view.dom.isConnected) return action();
      })
      .catch((reason: unknown) => {
        if (view.dom.isConnected)
          onError(`操作未完成：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };
  const item = (label: string, action: () => void | Promise<void>, disabled = false) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={() => run(action)}>
      <span>{label}</span>{' '}
      {state.kind !== 'table' && shortcuts[label] && <kbd>{shortcuts[label]}</kbd>}
    </button>
  );
  const copySelection = async () => {
    if (!state.copy) return;
    const notices = await writeCopy(state.copy);
    if (notices.length) onError(notices.join('\n'));
  };
  const cutSelection = async () => {
    const originalDoc = view.state.doc,
      selection = view.state.selection;
    if (!state.copy?.range) return;
    const { from, to } = state.copy.range;
    if (view.state.sliceDoc(from, to) !== (state.copy.sourceText ?? state.copy.markdown)) {
      onError('原选区内容已变化，请重新选择后剪切。');
      return;
    }
    const notices = await writeCopy(state.copy);
    if (!view.dom.isConnected) return;
    if (!view.state.doc.eq(originalDoc) || !view.state.selection.eq(selection)) {
      onError('正文或选区已变化，已复制原文字，本次未剪切。');
      return;
    }
    view.dispatch({
      changes: { from, to },
      userEvent: 'delete.cut',
    });
    view.focus();
    if (notices.length) onError(notices.join('\n'));
  };
  const tableAction = (label: string) => {
    if (!state.input?.isConnected) return;
    state.input?.focus();
    [
      ...(state.input
        ?.closest('.markdown-table-widget')
        ?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ]
      .find((button) => button.textContent === label)
      ?.click();
  };
  const cutCell = async () => {
    const input = state.input!,
      value = input.value;
    await copyText(value);
    if (!input.isConnected) return;
    if (input.value !== value) {
      onError('单元格已变化，本次未剪切新内容。');
      return;
    }
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };
  const pasteCell = async () => {
    const input = state.input!,
      value = input.value,
      from = input.selectionStart ?? 0,
      to = input.selectionEnd ?? from;
    const text = await navigator.clipboard.readText();
    if (!input.isConnected) return;
    if (input.value !== value) {
      onError('单元格已变化，未覆盖新内容，请重新粘贴。');
      return;
    }
    const insert = text.replace(/\r\n?/g, '\n');
    input.value = value.slice(0, from) + insert + value.slice(to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.setSelectionRange(from + insert.length, from + insert.length);
  };
  const label =
    state.kind === 'table'
      ? '表格编辑菜单'
      : state.kind === 'code'
        ? '代码编辑菜单'
        : '正文编辑菜单';
  return createPortal(
    <div className="editor-context-menu" style={{ left: state.left, top: state.top }}>
      <DropdownMenu label={label} onClose={onClose}>
        {state.input ? (
          <>
            {item('复制单元格', () => copyText(state.input!.value))}
            {item('剪切单元格', cutCell)}
            {item('粘贴为纯文本', pasteCell)}
            {item('在下方插入行', () => tableAction('+ 行'))}
            {item('在右侧插入列', () => tableAction('+ 列'))}
          </>
        ) : (
          <>
            {state.code && (
              <>
                {item('复制代码', () => copyText(state.code!.source))}
                {item('编辑代码', () => {
                  const line = view.state.doc.lineAt(state.code!.from);
                  view.dispatch({
                    selection: { anchor: Math.min(view.state.doc.length, line.to + 1) },
                  });
                  view.focus();
                })}
              </>
            )}
            {item('撤销', () => {
              undo(view);
              view.focus();
            })}
            {item('重做', () => {
              redo(view);
              view.focus();
            })}
            {item('剪切', cutSelection, state.readOnly || !state.copy?.range)}
            {item('复制', copySelection, !state.copy)}
            {item('粘贴', pasteRich, state.readOnly)}
            {item('粘贴为纯文本', pastePlain, state.readOnly)}
            {item('全选', () => {
              view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
              view.focus();
            })}
          </>
        )}
      </DropdownMenu>
    </div>,
    view.dom.closest('.app') || view.dom.ownerDocument.body,
  );
}
