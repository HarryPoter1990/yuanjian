import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

describe('moves, recovery and attachments', () => {
  let sandbox: string;
  let root: string;
  let store: NoteStore;
  let now = 1800000000000;
  beforeEach(async () => {
    now = 1800000000000;
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'qingjian-history-'));
    root = path.join(sandbox, '测试资料');
    await mkdir(root);
    store = new NoteStore(path.join(sandbox, 'app-data'), {
      trash: async (file) => rm(file),
      now: () => now,
    });
    await store.initialize();
    await store.approveDirectory(root);
    await store.saveSettings({ ...store.getSettings(), roots: [root] });
  });
  afterEach(async () => {
    await store.dispose();
    await rm(sandbox, { recursive: true, force: true });
  });
  it('repairs incoming links and moved-note attachments, and undo restores exact original bytes', async () => {
    const source = path.join(root, '原始.md');
    const inbound = path.join(root, '引用.md');
    const destination = path.join(root, '子目录', '新名称.md');
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', '图.png'), Buffer.from([1, 2, 3]));
    const sourceText = '# 原始\n\n![图](assets/图.png)\n';
    const inboundText = '# 引用\n\n[文字](原始.md#标题)\n\n[[原始|显示文字]]\n';
    await writeFile(source, sourceText);
    await writeFile(inbound, inboundText);
    const moved = (await store.moveFile(source, destination))!;
    expect(await readFile(inbound, 'utf8')).toContain('子目录/新名称.md#标题');
    expect(await readFile(destination, 'utf8')).toContain('../assets/图.png');
    expect(moved.affected).toContain(inbound);
    await store.undoMove(moved.undoId);
    expect(await readFile(source, 'utf8')).toBe(sourceText);
    expect(await readFile(inbound, 'utf8')).toBe(inboundText);
    await expect(readFile(destination)).rejects.toThrow();
  });
  it('refuses undo when a repaired document was edited afterward, preserving current files', async () => {
    const source = path.join(root, '原始.md');
    const inbound = path.join(root, '引用.md');
    await writeFile(source, '# 原始');
    await writeFile(inbound, '[原始](原始.md)');
    const moved = (await store.moveFile(source, path.join(root, '新名称.md')))!;
    await writeFile(inbound, '后续编辑');
    await expect(store.undoMove(moved.undoId)).rejects.toThrow(/修改/);
    expect(await readFile(inbound, 'utf8')).toBe('后续编辑');
    expect(await readFile(moved.path, 'utf8')).toBe('# 原始');
  });
  it('deduplicates history images, restores image bytes and snapshots before restore', async () => {
    const file = path.join(root, '学习.md');
    await mkdir(path.join(root, 'assets'));
    const image = path.join(root, 'assets', '截图.png');
    await writeFile(image, Buffer.from([1, 2, 3]));
    await writeFile(file, '# 原文\n\n![截图](assets/截图.png)\n');
    let note = (await store.openFile(file))!;
    for (let i = 0; i < 3; i++) {
      now += 40_000;
      const saved = await store.saveFile({
        path: file,
        content: `${note.content}\n第 ${i} 次`,
        baseContent: note.content,
        hash: note.hash,
        title: note.title,
      });
      note = saved.note!;
    }
    expect((await readdir(path.join(sandbox, 'app-data', 'history', 'images'))).length).toBe(1);
    expect((await store.historyStats()).imageBytes).toBe(3);
    const baseline = (await store.listHistory(file)).find(
      (entry) => entry.reason === '修改前基线',
    )!;
    await writeFile(image, Buffer.from([7, 8, 9]));
    await store.restoreHistory(baseline.id);
    expect(await readFile(image)).toEqual(Buffer.from([1, 2, 3]));
    expect((await store.listHistory(file)).some((entry) => entry.reason === '恢复前')).toBe(true);
  });
  it('expires deleted-note history and preserves the latest history of existing notes', async () => {
    const file = path.join(root, '日记.md');
    await writeFile(file, '旧');
    const note = (await store.openFile(file))!;
    await store.saveFile({
      path: file,
      content: '新',
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    now += 31 * 86400_000;
    await store.pruneHistory();
    expect(await store.listHistory(file)).toHaveLength(1);
    await store.trashFile(file);
    now += 31 * 86400_000;
    await store.pruneHistory();
    expect(await store.listHistory(file)).toHaveLength(0);
  });
  it('keeps pinned snapshots when over capacity and reports the excess on subsequent stats calls', async () => {
    const file = path.join(root, '大笔记.md');
    await writeFile(file, 'a'.repeat(600_000));
    await store.saveSettings({ ...store.getSettings(), historyLimitMB: 1 });
    const note = (await store.openFile(file))!;
    const saved = await store.saveFile({
      path: file,
      content: `${note.content}b`,
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    expect(saved.status).toBe('saved');
    for (const entry of await store.listHistory(file)) await store.pinHistory(entry.id, true);
    now += 40_000;
    const next = saved.note!;
    await store.saveFile({
      path: file,
      content: `${next.content}c`,
      baseContent: next.content,
      hash: next.hash,
      title: next.title,
    });
    expect((await store.historyStats()).totalBytes).toBeGreaterThan(1024 * 1024);
    expect((await store.historyStats()).warning).toBeTruthy();
  });
  it('rejects attachment path escape, detects references and rechecks before trash', async () => {
    const file = path.join(root, '附件.md');
    await writeFile(file, '# 笔记');
    const placed = await store.putAttachment(file, '截图.png', [1, 2, 3]);
    expect((await store.scanAttachments()).map((item) => item.path)).toContain(placed.path);
    await writeFile(file, `![截图](${placed.reference})`);
    await expect(store.trashAttachments([placed.path])).rejects.toThrow(/引用/);
    await expect(
      store.saveSettings({ ...store.getSettings(), attachmentPattern: '../escape' }),
    ).rejects.toThrow();
    expect(await readFile(placed.path)).toEqual(Buffer.from([1, 2, 3]));
  });
  it('preserves assets referenced by an explicitly opened standalone note outside the indexed roots', async () => {
    await mkdir(path.join(root, 'assets'));
    const image = path.join(root, 'assets', '图片.png');
    await writeFile(image, 'picture');
    const standalone = path.join(sandbox, '单独打开.md');
    await writeFile(standalone, '![图片](测试资料/assets/图片.png)');
    await store.approveFile(standalone);
    await store.openFile(standalone);
    expect(await store.scanAttachments()).toEqual([]);
    await expect(store.trashAttachments([image])).rejects.toThrow(/引用/);
  });
  it('preserves assets referenced by an unsaved session edit even before the note is saved', async () => {
    const file = path.join(root, '未保存修改.md');
    await writeFile(file, '# 原文');
    const note = (await store.openFile(file))!;
    const attachment = await store.putAttachment(file, '新图片.png', [1, 2, 3]);
    await store.saveSession({
      activeId: note.id,
      tabs: [
        {
          ...note,
          baseContent: note.content,
          content: `${note.content}\n![图片](${attachment.reference})`,
          dirty: true,
          cursor: 0,
          scrollTop: 0,
          mode: 'live',
        },
      ],
    });
    expect(await store.scanAttachments()).toEqual([]);
    await expect(store.trashAttachments([attachment.path])).rejects.toThrow(/引用/);
  });
});
