import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

describe('desktop storage boundary and concurrent edits', () => {
  let sandbox: string;
  let root: string;
  let store: NoteStore;
  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-storage-'));
    root = path.join(sandbox, '中文笔记');
    await mkdir(root);
    store = new NoteStore(path.join(sandbox, 'app-data'), {
      trash: async (file) => rm(file),
      now: () => 1800000000000,
    });
    await store.initialize();
    await store.approveDirectory(root);
    await store.saveSettings({ ...store.getSettings(), roots: [root] });
  });
  afterEach(async () => {
    await store.dispose();
    await rm(sandbox, { recursive: true, force: true });
  });

  it('rejects unapproved paths and settings cannot grant arbitrary directories', async () => {
    const privateFile = path.join(sandbox, 'private.md');
    await writeFile(privateFile, 'secret');
    await expect(store.openFile(privateFile)).rejects.toThrow(/授权/);
    await expect(store.saveSettings({ ...store.getSettings(), roots: [sandbox] })).rejects.toThrow(
      /授权/,
    );
  });

  it('preserves BOM and CRLF and creates no history merely by opening/indexing', async () => {
    const file = path.join(root, '公式.md');
    const original = '\ufeff# 标题\r\n\r\n$x^2$\r\n';
    await writeFile(file, original);
    const note = (await store.openFile(file))!;
    await store.getIndex();
    expect(await store.listHistory()).toEqual([]);
    await store.saveFile({
      path: file,
      content: note.content,
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(await store.listHistory()).toEqual([]);
    await store.saveFile({
      path: file,
      content: note.content.replace('标题', '新标题'),
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    expect(await readFile(file, 'utf8')).toBe(original.replace('标题', '新标题'));
    expect((await store.listHistory()).length).toBeGreaterThanOrEqual(2);
  });

  it('merges independent external edits and refuses overlapping changes without touching disk', async () => {
    const file = path.join(root, '并发.md');
    await writeFile(file, '甲\n乙\n丙\n');
    const note = (await store.openFile(file))!;
    await writeFile(file, '甲\n乙\n外部\n');
    const merged = await store.saveFile({
      path: file,
      content: '内部\n乙\n丙\n',
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    expect(merged.status).toBe('saved');
    expect(merged.merged).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('内部\n乙\n外部\n');
    const current = merged.note!;
    await writeFile(file, '第三方\n乙\n外部\n');
    const conflict = await store.saveFile({
      path: file,
      content: '我的\n乙\n外部\n',
      baseContent: current.content,
      hash: current.hash,
      title: current.title,
    });
    expect(conflict.status).toBe('conflict');
    expect(conflict.conflict?.ours).toContain('我的');
    expect(await readFile(file, 'utf8')).toBe('第三方\n乙\n外部\n');
  });

  it('does not recreate an externally deleted file during automatic save', async () => {
    const file = path.join(root, '删除.md');
    await writeFile(file, 'before');
    const note = (await store.openFile(file))!;
    await rm(file);
    expect(
      (
        await store.saveFile({
          path: file,
          content: 'after',
          baseContent: note.content,
          hash: note.hash,
          title: note.title,
        })
      ).status,
    ).toBe('conflict');
    await expect(readFile(file)).rejects.toThrow();
  });

  it('saves tags without changing the Markdown body and indexes excluded paths correctly', async () => {
    const file = path.join(root, '标签.md');
    const body = '# 标题  \r\n\r\n原样 *保留*\r\n';
    await writeFile(file, `---\r\ntitle: 原标题\r\n---\r\n${body}`);
    const tagged = await store.setTags(file, ['学习', '#数学', '学习']);
    expect(tagged.content.endsWith(body)).toBe(true);
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', '不能索引.md'), '# 不可见');
    const index = await store.getIndex();
    expect(index).toHaveLength(1);
    expect(index[0].tags).toEqual(expect.arrayContaining(['学习', '数学']));
  });
});
