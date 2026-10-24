import { describe, expect, it, vi } from 'vitest';
import { presentMoveOutcome, type MoveFeedbackContext } from '../src/ui/moveFeedback';
import type { MoveOutcome } from '../src/shared/types';

function fixture() {
  const changes: Array<{ id: string; path?: string | null }> = [];
  const notices: Array<{
    message: string;
    error?: boolean;
    action?: { label: string; run(): void };
  }> = [];
  const jobs: Promise<void>[] = [];
  const context: MoveFeedbackContext = {
    tabId: 'stable-note-id',
    api: {
      openFile: vi.fn(async (path) => ({
        id: path,
        path,
        title: path,
        content: '移动后原文',
        hash: 'new',
        modifiedAt: 1,
      })),
      undoMove: vi.fn(async () => ({ path: 'D:/original.md', affected: [], undoId: 'operation' })),
      retryMoveHistory: vi.fn(async () => {}),
    },
    updateTab: (id, value) => {
      changes.push({ id, ...value });
    },
    refresh: vi.fn(async () => {}),
    notify: (message, error, action) => {
      notices.push({ message, error, action });
    },
    perform: (_label, action) => {
      jobs.push(action());
    },
  };
  const result: MoveOutcome = {
    path: 'D:/moved.md',
    affected: ['D:/incoming.md'],
    undoId: 'operation',
    historyWarning: '文件已完成，历史尚未完成',
    historyRetryId: 'operation',
  };
  return { context, result, changes, notices, jobs };
}
describe('move feedback follows the committed file result', () => {
  it('updates the actual path and offers both undo and a history-only retry for a partial result', async () => {
    const { context, result, changes, notices, jobs } = fixture();
    await presentMoveOutcome(result, context);
    expect(changes[0]).toMatchObject({ id: 'stable-note-id', path: result.path });
    expect(notices.some((notice) => notice.action?.label === '撤销移动')).toBe(true);
    notices.find((notice) => notice.action?.label === '重试历史补记')!.action!.run();
    await Promise.all(jobs);
    expect(context.api.retryMoveHistory).toHaveBeenCalledExactlyOnceWith('operation');
    expect(context.api.openFile).toHaveBeenCalledTimes(1);
    expect(context.api.undoMove).not.toHaveBeenCalled();
    expect(notices.at(-1)?.message).toBe('历史补记已完成');
  });
  it('uses the actual undo outcome and retains its pending-history feedback without attempting another undo', async () => {
    const { context, result, changes, notices, jobs } = fixture();
    vi.mocked(context.api.undoMove).mockResolvedValue({ ...result, path: 'D:/restored-actual.md' });
    await presentMoveOutcome(result, context);
    notices.find((notice) => notice.action?.label === '撤销移动')!.action!.run();
    await Promise.all(jobs);
    expect(changes.at(-1)?.path).toBe('D:/restored-actual.md');
    expect(context.api.openFile).toHaveBeenLastCalledWith('D:/restored-actual.md');
    expect(notices.filter((notice) => notice.action?.label === '撤销移动')).toHaveLength(1);
    expect(notices.filter((notice) => notice.action?.label === '重试历史补记')).toHaveLength(2);
  });
  it('does not report that a completed move failed when UI reload or index refresh fails', async () => {
    const { context, result, changes, notices } = fixture();
    vi.mocked(context.api.openFile).mockRejectedValue(Error('生成读盘失败'));
    vi.mocked(context.refresh).mockRejectedValue(Error('生成刷新失败'));
    await expect(presentMoveOutcome(result, context)).resolves.toBeUndefined();
    expect(changes[0].path).toBe(result.path);
    expect(notices.at(-1)?.message).toContain('文件移动已完成');
    expect(notices.at(-1)?.message).toContain('生成读盘失败');
    expect(notices.at(-1)?.message).toContain('生成刷新失败');
    expect(notices.some((notice) => notice.action?.label === '撤销移动')).toBe(true);
  });
});
