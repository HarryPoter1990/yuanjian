import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

const fault = vi.hoisted(() => ({ index: '', writes: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      fault.writes.push(String(to));
      if (String(to) === fault.index)
        throw Object.assign(new Error('生成历史索引写入失败'), { code: 'EACCES' });
      return actual.rename(from, to);
    },
  };
});

describe('file movement completion is separate from recoverable history work', () => {
  let directory: string;
  let root: string;
  let profile: string;
  let from: string;
  let to: string;
  let inbound: string;
  let store: NoteStore;
  let events: string[][];
  const original = '# 原文\n\n[旁边](other.md)\n';
  const incoming = '[引用](before.md)\n';
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-move-completion-'));
    root = path.join(directory, 'notes');
    profile = path.join(directory, 'profile');
    await mkdir(root);
    from = path.join(root, 'before.md');
    to = path.join(root, 'sub', 'after.md');
    inbound = path.join(root, 'inbound.md');
    await writeFile(from, original);
    await writeFile(inbound, incoming);
    await writeFile(path.join(root, 'other.md'), '# 旁边');
    events = [];
    store = new NoteStore(profile, { changed: (files) => events.push(files) });
    await store.initialize();
    await store.approveDirectory(root);
    await store.saveSettings({ ...store.getSettings(), roots: [root] });
    fault.index = '';
    fault.writes = [];
  });
  afterEach(async () => {
    fault.index = '';
    vi.restoreAllMocks();
    await store.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  function failHistoryMapping() {
    let failing = true;
    const moved = store.history.moved.bind(store.history);
    vi.spyOn(store.history, 'moved').mockImplementation(async (oldPath, newPath) => {
      if (failing) fault.index = path.join(profile, 'history', 'index.json');
      try {
        await moved(oldPath, newPath);
      } finally {
        fault.index = '';
      }
    });
    return () => {
      failing = false;
    };
  }
  it('returns the committed path, usable undo and history retry when index persistence fails', async () => {
    failHistoryMapping();
    const outcome = (await store.moveFile(from, to))!;
    expect(outcome.path).toBe(to);
    expect(outcome.undoId).toBeTruthy();
    expect(outcome.historyWarning).toContain('生成历史索引写入失败');
    expect(outcome.historyRetryId).toBeTruthy();
    expect(await readFile(to, 'utf8')).toBe(original.replace('(other.md)', '(../other.md)'));
    expect(await readFile(inbound, 'utf8')).toBe(incoming.replace('before.md', 'sub/after.md'));
    await expect(stat(from)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events.some((files) => files.includes(to))).toBe(true);
  });
  it('keeps a failed history retry available and never rewrites or moves committed note files', async () => {
    const recover = failHistoryMapping();
    const outcome = (await store.moveFile(from, to))!;
    fault.writes = [];
    await expect(store.retryMoveHistory(outcome.historyRetryId!)).rejects.toThrow(
      '生成历史索引写入失败',
    );
    recover();
    await store.retryMoveHistory(outcome.historyRetryId!);
    expect(fault.writes.filter((file) => file.startsWith(root + path.sep))).toEqual([]);
    expect(await readFile(to, 'utf8')).toBe(original.replace('(other.md)', '(../other.md)'));
    const undone = await store.undoMove(outcome.undoId);
    expect(undone.path).toBe(from);
    expect(undone.historyWarning).toBeUndefined();
    expect(await readFile(from, 'utf8')).toBe(original);
    expect(await readFile(inbound, 'utf8')).toBe(incoming);
  });
  it('can undo a committed move even while its history work is pending', async () => {
    const recover = failHistoryMapping();
    const outcome = (await store.moveFile(from, to))!;
    events.length = 0;
    const undone = await store.undoMove(outcome.undoId);
    expect(undone.path).toBe(from);
    expect(undone.historyWarning).toContain('生成历史索引写入失败');
    expect(undone.historyRetryId).toBeTruthy();
    expect(await readFile(from, 'utf8')).toBe(original);
    expect(await readFile(inbound, 'utf8')).toBe(incoming);
    await expect(stat(to)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events.some((files) => files.includes(from))).toBe(true);
    await expect(store.undoMove(outcome.undoId)).rejects.toThrow(/已撤销|失效/);
    fault.writes = [];
    recover();
    await store.retryMoveHistory(undone.historyRetryId!);
    expect(fault.writes.filter((file) => file.startsWith(root + path.sep))).toEqual([]);
    expect(await readFile(from, 'utf8')).toBe(original);
  });
  it('persists a post-move snapshot retry even when the first failure already changed in-memory history', async () => {
    let failing = true;
    const snapshot = store.history.snapshot.bind(store.history);
    vi.spyOn(store.history, 'snapshot').mockImplementation(
      async (file, content, reason, coalesce) => {
        if (failing && reason === '移动修复后')
          fault.index = path.join(profile, 'history', 'index.json');
        try {
          await snapshot(file, content, reason, coalesce);
        } finally {
          fault.index = '';
        }
      },
    );
    const outcome = (await store.moveFile(from, to))!;
    expect(outcome.historyWarning).toBeTruthy();
    failing = false;
    fault.writes = [];
    await store.retryMoveHistory(outcome.historyRetryId!);
    expect(fault.writes.filter((file) => file.startsWith(root + path.sep))).toEqual([]);
    const restarted = new NoteStore(profile);
    try {
      await restarted.initialize();
      const entries = await restarted.listHistory(to);
      expect(entries.some((entry) => entry.reason === '移动修复后')).toBe(true);
      const after = entries.find((entry) => entry.reason === '移动修复后')!;
      expect((await restarted.readHistory(after.id)).content).toBe(await readFile(to, 'utf8'));
    } finally {
      await restarted.dispose();
    }
  });
  it('keeps pre-commit history backup failures as errors without moving any file', async () => {
    vi.spyOn(store.history, 'snapshot').mockRejectedValueOnce(new Error('生成前置备份失败'));
    await expect(store.moveFile(from, to)).rejects.toThrow('生成前置备份失败');
    expect(await readFile(from, 'utf8')).toBe(original);
    expect(await readFile(inbound, 'utf8')).toBe(incoming);
    await expect(stat(to)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events).toEqual([]);
  });
  it('keeps later edits as the latest history version when retrying delayed history work', async () => {
    const recover = failHistoryMapping();
    const outcome = (await store.moveFile(from, to))!;
    const document = (await store.openFile(to))!;
    const latest = document.content + '\n用户后续输入\n';
    const saved = await store.saveFile({
      path: to,
      content: latest,
      baseContent: document.content,
      hash: document.hash,
      title: document.title,
    });
    expect(saved.status).toBe('saved');
    recover();
    fault.writes = [];
    await store.retryMoveHistory(outcome.historyRetryId!);
    expect(await readFile(to, 'utf8')).toBe(latest);
    expect(fault.writes.filter((file) => file.startsWith(root + path.sep))).toEqual([]);
    const entries = await store.listHistory(to);
    expect((await store.readHistory(entries[0].id)).content).toBe(latest);
  });
  it('does not manufacture snapshots at a superseded path after another successful move', async () => {
    const recover = failHistoryMapping();
    const first = (await store.moveFile(from, to))!;
    recover();
    const final = path.join(root, 'final.md');
    const second = (await store.moveFile(to, final))!;
    expect(second.historyWarning).toBeUndefined();
    fault.writes = [];
    await expect(store.retryMoveHistory(first.historyRetryId!)).rejects.toThrow(/位置|存在|ENOENT/);
    expect((await readFile(final, 'utf8')).includes('# 原文')).toBe(true);
    expect(fault.writes.filter((file) => file.startsWith(root + path.sep))).toEqual([]);
    expect(await store.listHistory(to)).toEqual([]);
  });
  it('refuses an unverified replacement at the same path without modifying that new file', async () => {
    const recover = failHistoryMapping();
    const outcome = (await store.moveFile(from, to))!;
    await rm(to);
    await writeFile(to, '# 另一个文件\n');
    recover();
    fault.writes = [];
    await expect(store.retryMoveHistory(outcome.historyRetryId!)).rejects.toThrow(/确认|变化|替换/);
    expect(await readFile(to, 'utf8')).toBe('# 另一个文件\n');
    expect(fault.writes.filter((file) => file.startsWith(root + path.sep))).toEqual([]);
  });
  it('preserves BOM and CRLF in committed bytes, retried snapshots and undo', async () => {
    const bytes = Buffer.from('\ufeff' + original.replace(/\n/g, '\r\n'));
    await writeFile(from, bytes);
    const recover = failHistoryMapping();
    const outcome = (await store.moveFile(from, to))!;
    const movedBytes = await readFile(to);
    expect(movedBytes.toString('utf8')).toBe(
      bytes.toString('utf8').replace('(other.md)', '(../other.md)'),
    );
    recover();
    await store.retryMoveHistory(outcome.historyRetryId!);
    const entry = (await store.listHistory(to)).find((item) => item.reason === '移动修复后')!;
    expect((await store.readHistory(entry.id)).content).toBe(movedBytes.toString('utf8'));
    await store.undoMove(outcome.undoId);
    expect(await readFile(from)).toEqual(bytes);
  });
});
