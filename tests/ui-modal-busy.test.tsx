// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal, OperationContext } from '../src/components/Controls';
import { AttachmentPanel, HistoryPanel } from '../src/components/RecoveryPanels';
import type { HistoryEntry } from '../src/shared/types';
import { asTab } from '../src/ui/model';

let host: HTMLDivElement;
let root: Root;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function button(text: string) {
  const result = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

async function dismiss() {
  const dialog = host.querySelector('dialog');
  if (!dialog) throw new Error('Missing dialog');
  await act(async () => {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: -10, clientY: -10 }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('modal operations in progress', () => {
  it.each(['local', 'context'] as const)(
    'rechecks %s busy state after the discard prompt was already opened',
    async (source) => {
      const onClose = vi.fn();
      async function render(busy: boolean) {
        await act(async () =>
          root.render(
            <OperationContext.Provider
              value={{ busy: source === 'context' && busy ? '移动笔记' : '', notice: null }}
            >
              <Modal
                title="未提交异步表单"
                pending
                busy={source === 'local' && busy}
                onClose={onClose}
              >
                <input aria-label="目标路径" />
              </Modal>
            </OperationContext.Provider>,
          ),
        );
      }
      await render(false);
      await dismiss();
      expect(host.textContent).toContain('放弃输入并关闭');
      await render(true);
      await act(async () => button('放弃输入并关闭').click());
      expect(onClose).not.toHaveBeenCalled();
      expect(host.textContent).toContain('请等待完成后关闭');
      await render(false);
      await act(async () => button('放弃输入并关闭').click());
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps history restoration modal open on Escape and backdrop until restoration completes', async () => {
    const entry: HistoryEntry = {
      id: 'old-version',
      path: 'D:/fixture.md',
      createdAt: 1,
      pinned: false,
      reason: 'saved',
      textBytes: 3,
      imageBytes: 0,
    };
    vi.stubGlobal('notes', {
      listHistory: vi.fn(async () => [entry]),
      readHistory: vi.fn(async () => ({ entry, content: '旧正文' })),
    });
    const restore = deferred<void>();
    const onClose = vi.fn();
    const onRestore = vi.fn(() => restore.promise);
    await act(async () =>
      root.render(
        <HistoryPanel
          tab={asTab({
            id: 'note',
            path: entry.path,
            title: 'fixture.md',
            content: '当前正文',
            hash: 'a',
            modifiedAt: 1,
          })}
          onClose={onClose}
          onRestore={onRestore}
          onError={vi.fn()}
        />,
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>('.history-list button')?.click());
    await act(async () => button('恢复此版本').click());
    await act(async () => button('保存当前状态并恢复').click());
    expect(onRestore).toHaveBeenCalledWith(entry.id);
    expect(button('保存当前状态并恢复').disabled).toBe(true);
    await dismiss();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.textContent).toContain('请等待完成后关闭');
    await act(async () => restore.resolve());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('protects attachment removal from Escape and backdrop while the local removal is pending', async () => {
    const removal = deferred<void>();
    const scan = vi
      .fn()
      .mockResolvedValueOnce([{ path: 'D:/assets/picture.png', bytes: 20, references: [] }])
      .mockResolvedValue([]);
    const trash = vi.fn(() => removal.promise);
    vi.stubGlobal('notes', { scanAttachments: scan, trashAttachments: trash });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    await act(async () =>
      root.render(<AttachmentPanel onClose={onClose} onError={vi.fn()} onSuccess={onSuccess} />),
    );
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await act(async () => button('将所选移入回收站').click());
    await act(async () => button('确认移入回收站').click());
    expect(trash).toHaveBeenCalledWith(['D:/assets/picture.png']);
    await dismiss();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.textContent).toContain('请等待完成后关闭');
    expect(host.textContent).not.toContain('放弃输入并关闭');
    await act(async () => removal.resolve());
    expect(onSuccess).toHaveBeenCalledWith('已将 1 个附件移入回收站');
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
