import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

const faults = vi.hoisted(() => ({ failTarget: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (source: string, destination: string) => {
      if (destination === faults.failTarget) {
        faults.failTarget = '';
        throw Object.assign(new Error('simulated filesystem refusal'), { code: 'EPERM' });
      }
      return actual.rename(source, destination);
    },
  };
});

describe('atomic-save failure handling', () => {
  let sandbox: string;
  let root: string;
  let store: NoteStore;
  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'qingjian-atomic-'));
    root = path.join(sandbox, '笔记');
    await mkdir(root);
    store = new NoteStore(path.join(sandbox, 'data'));
    await store.initialize();
    await store.approveDirectory(root);
  });
  afterEach(async () => {
    faults.failTarget = '';
    await store.dispose();
    await rm(sandbox, { recursive: true, force: true });
  });
  it('keeps the original file on atomic replacement failure, removes temporary files and permits retry', async () => {
    const file = path.join(root, '原文.md');
    await writeFile(file, '原文');
    const note = (await store.openFile(file))!;
    const request = {
      path: file,
      content: '新内容',
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    };
    faults.failTarget = file;
    await expect(store.saveFile(request)).rejects.toThrow('simulated filesystem refusal');
    expect(await readFile(file, 'utf8')).toBe('原文');
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect((await store.saveFile(request)).status).toBe('saved');
    expect(await readFile(file, 'utf8')).toBe('新内容');
  });
  it('rolls back a move when an incoming-link file refuses its atomic rewrite', async () => {
    await store.saveSettings({ ...store.getSettings(), roots: [root] });
    const from = path.join(root, '原文.md');
    const to = path.join(root, '新名.md');
    const reference = path.join(root, '引用.md');
    await writeFile(from, '# 原文');
    await writeFile(reference, '[原文](原文.md)');
    faults.failTarget = reference;
    await expect(store.moveFile(from, to)).rejects.toThrow('simulated filesystem refusal');
    expect(await readFile(from, 'utf8')).toBe('# 原文');
    expect(await readFile(reference, 'utf8')).toBe('[原文](原文.md)');
    await expect(readFile(to)).rejects.toThrow();
  });
  it('does not overwrite an external edit arriving during slow move-history snapshots', async () => {
    await store.saveSettings({ ...store.getSettings(), roots: [root] });
    const from = path.join(root, '原文.md');
    const to = path.join(root, '子目录', '新名.md');
    const reference = path.join(root, '引用.md');
    await writeFile(from, '# 原文');
    await writeFile(reference, '[原文](原文.md)');
    const originalSnapshot = store.history.snapshot.bind(store.history);
    let injected = false;
    vi.spyOn(store.history, 'snapshot').mockImplementation(async (...arguments_) => {
      await originalSnapshot(...arguments_);
      if (!injected) {
        injected = true;
        await writeFile(reference, '外部编辑器的新内容');
      }
    });
    await expect(store.moveFile(from, to)).rejects.toThrow(/修改/);
    expect(await readFile(reference, 'utf8')).toBe('外部编辑器的新内容');
    expect(await readFile(from, 'utf8')).toBe('# 原文');
    await expect(readFile(to)).rejects.toThrow();
  });
  it('keeps the current note and shared image when the restored note refuses atomic replacement', async () => {
    const file = path.join(root, '恢复.md');
    const image = path.join(root, 'assets', '图.png');
    await mkdir(path.dirname(image));
    await writeFile(image, Buffer.from([1, 2, 3]));
    await writeFile(file, '![图](assets/图.png)\n');
    const note = (await store.openFile(file))!;
    await store.saveFile({
      path: file,
      content: '当前文字',
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    const baseline = (await store.listHistory(file)).find(
      (entry) => entry.reason === '修改前基线',
    )!;
    await writeFile(image, Buffer.from([7, 8, 9]));
    faults.failTarget = file;
    await expect(store.restoreHistory(baseline.id)).rejects.toThrow('simulated filesystem refusal');
    expect(await readFile(file, 'utf8')).toBe('当前文字');
    expect(await readFile(image)).toEqual(Buffer.from([7, 8, 9]));
  });
});
