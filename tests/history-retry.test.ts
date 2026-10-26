import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';
let dir = '';
afterEach(async () => {
  vi.restoreAllMocks();
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  dir = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-retry-'));
  const root = path.join(dir, 'notes');
  await mkdir(root);
  const file = path.join(root, 'before.md');
  await writeFile(file, '原文\n');
  const profile = path.join(dir, 'data');
  const store = new NoteStore(profile);
  await store.initialize();
  await store.approveDirectory(root);
  await store.saveSettings({ ...store.getSettings(), roots: [root] });
  return { store, file, root, profile };
}
it('reports the committed save and retries its captured history after restart without rewriting a later note', async () => {
  const { store, file, profile } = await setup();
  const note = (await store.openFile(file))!;
  const real = store.history.snapshot.bind(store.history);
  vi.spyOn(store.history, 'snapshot').mockImplementation(async (...args) => {
    if (args[2] === '编辑后') throw Error('generated history failure');
    return real(...args);
  });
  const result = await store.saveFile({
    ...note,
    baseContent: note.content,
    content: '保存的版本\n',
  });
  expect(result.status).toBe('saved');
  expect(result.note?.content).toBe('保存的版本\n');
  expect(result.historyWarning).toContain('正文已保存');
  expect(result.historyRetryId).toBeTruthy();
  await store.dispose();
  vi.restoreAllMocks();
  await writeFile(file, '后来外部修改\n');
  const reopened = new NoteStore(profile);
  await reopened.initialize();
  expect(await reopened.pendingHistory()).toHaveLength(1);
  await reopened.retryHistoryWork(result.historyRetryId!);
  expect(await readFile(file, 'utf8')).toBe('后来外部修改\n');
  const entry = (await reopened.listHistory(file)).find((item) => item.reason === '保存后补记')!;
  expect((await reopened.readHistory(entry.id)).content).toBe('保存的版本\n');
  expect(await reopened.pendingHistory()).toEqual([]);
  await reopened.dispose();
});
it('retains a failed move history retry across restart and never repeats the move', async () => {
  const { store, file, root, profile } = await setup();
  vi.spyOn(store.history, 'moved').mockRejectedValue(Error('generated move history failure'));
  const target = path.join(root, 'after.md');
  const moved = (await store.moveFile(file, target))!;
  expect(moved.historyRetryId).toBeTruthy();
  await store.dispose();
  vi.restoreAllMocks();
  const reopened = new NoteStore(profile);
  await reopened.initialize();
  expect(await reopened.pendingHistory()).toHaveLength(1);
  await reopened.retryHistoryWork(moved.historyRetryId!);
  expect(await readFile(target, 'utf8')).toBe('原文\n');
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await reopened.pendingHistory()).toEqual([]);
  await reopened.dispose();
});
