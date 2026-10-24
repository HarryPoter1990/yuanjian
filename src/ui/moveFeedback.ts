import type { DesktopAPI, MoveOutcome, TabState } from '../shared/types';
import { errorText, fileName } from './model';
import type { Notice } from './useWorkspace';

export interface MoveFeedbackContext {
  tabId: string;
  api: Pick<DesktopAPI, 'openFile' | 'undoMove' | 'retryMoveHistory'>;
  updateTab(id: string, value: Partial<TabState>): void;
  refresh(): Promise<void>;
  notify(message: string, error?: boolean, action?: Notice['action']): void;
  perform(label: string, action: () => Promise<void>): void;
}

/** The file commit is authoritative even if history or subsequent UI refresh fails. */
export async function presentMoveOutcome(
  result: MoveOutcome,
  context: MoveFeedbackContext,
  undone = false,
): Promise<void> {
  context.updateTab(context.tabId, { path: result.path, title: fileName(result.path) });
  const warnings: string[] = [];
  try {
    const note = await context.api.openFile(result.path);
    if (note)
      context.updateTab(context.tabId, { ...note, baseContent: note.content, dirty: false });
    else warnings.push('未能重新读取笔记');
  } catch (error) {
    warnings.push(`重新读取失败：${errorText(error)}`);
  }
  try {
    await context.refresh();
  } catch (error) {
    warnings.push(`目录刷新失败：${errorText(error)}`);
  }

  context.notify(
    undone ? '移动和引用修改已撤销' : `已移动，修复 ${result.affected.length} 个引用文件`,
    false,
    undone
      ? undefined
      : {
          label: '撤销移动',
          run: () =>
            context.perform('撤销移动', async () => {
              const restored = await context.api.undoMove(result.undoId);
              await presentMoveOutcome(restored, context, true);
            }),
        },
  );
  if (result.historyWarning)
    context.notify(
      result.historyWarning,
      true,
      result.historyRetryId
        ? {
            label: '重试历史补记',
            run: () =>
              context.perform('补记移动历史', async () => {
                await context.api.retryMoveHistory(result.historyRetryId!);
                context.notify('历史补记已完成');
              }),
          }
        : undefined,
    );
  if (warnings.length)
    context.notify(
      `文件${undone ? '撤销' : '移动'}已完成，当前位置为 ${result.path}。${warnings.join('；')}`,
      true,
    );
}
