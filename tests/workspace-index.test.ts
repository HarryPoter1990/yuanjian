import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NoteStore } from '../electron/storage/store';
import { asTab } from '../src/ui/model';
let directory: string;
let root: string;
let store: NoteStore;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-index-'));
  root = path.join(directory, 'notes');
  await mkdir(path.join(root, 'sub'), { recursive: true });
  store = new NoteStore(path.join(directory, 'data'));
  await store.initialize();
  await store.approveDirectory(root);
  await store.saveSettings({ ...store.getSettings(), roots: [root] });
});
it('continues saving an already opened note and its draft after excluding its folder', async () => {
  const first = path.join(root, 'sub', 'opened.md');
  const second = path.join(root, 'sub', 'unopened.md');
  await writeFile(first, '# First');
  await writeFile(second, '# Second');
  const doc = (await store.openFile(first))!;
  const tab = { ...asTab(doc), content: '# Updated', dirty: true };
  await store.saveSettings({ ...store.getSettings(), excluded: ['sub'] });
  await expect(store.saveSession({ tabs: [tab], activeId: tab.id })).resolves.toBeUndefined();
  const saved = await store.saveFile({
    path: first,
    content: tab.content,
    title: doc.title,
    baseContent: doc.content,
    hash: doc.hash,
  });
  expect(saved.status).toBe('saved');
  expect(await readFile(first, 'utf8')).toBe('# Updated');
  expect((await store.getWorkspaceIndex()).notes).toEqual([]);
  await expect(store.openFile(second)).rejects.toThrow('未经授权');
});
it('looks up only configured journal dates in an independent directory', async () => {
  const journal = path.join(directory, 'journals');
  await mkdir(journal);
  await store.approveDirectory(journal);
  await store.saveSettings({
    ...store.getSettings(),
    journalDirectory: journal,
    dailyPattern: '{{year}}/{{month}}/{{day}}.md',
  });
  const entry = (await store.periodicNote('daily', '2024-02-29'))!;
  await writeFile(path.join(journal, 'unrelated-2024-02-28.md'), '# Not a journal');
  expect(await store.getDailyNotes('2024-02')).toEqual([
    { date: '2024-02-29', path: entry.path, title: entry.title },
  ]);
  expect(await store.getDailyNotes('2024-03')).toEqual([]);
  expect((await store.getWorkspaceIndex()).notes).toEqual([]);
});
afterEach(async () => {
  await store.dispose();
  await rm(directory, { recursive: true, force: true });
});
it('keeps readable notes and reports unreadable paths during indexing and link resolution', async () => {
  const file = path.join(root, 'sub', 'target.md');
  await writeFile(file, '# 目标');
  const bad = path.join(root, 'broken.md');
  await writeFile(bad, Buffer.from([255, 254, 0, 1]));
  const snapshot = await store.getWorkspaceIndex();
  expect(snapshot.notes.map((n) => n.path)).toContain(file);
  expect(snapshot.issues.map((i) => i.path)).toEqual([bad]);
  expect((await store.resolveLink(path.join(root, 'source.md'), 'target')).path).toBe(file);
});
it('shares scans, reuses unchanged metadata, and invalidates changed files', async () => {
  const file = path.join(root, 'note.md');
  await writeFile(file, '# 原标题');
  const read = vi.spyOn(store, 'readNote');
  await Promise.all(Array.from({ length: 8 }, () => store.getWorkspaceIndex()));
  expect(read).toHaveBeenCalledTimes(1);
  await store.getWorkspaceIndex(true);
  expect(read).toHaveBeenCalledTimes(1);
  await writeFile(file, '# 新标题');
  store.invalidateIndex([file]);
  expect((await store.getWorkspaceIndex()).notes[0].title).toBe('新标题');
  expect(read).toHaveBeenCalledTimes(2);
  await rm(file);
  store.invalidateIndex([file]);
  expect((await store.getWorkspaceIndex()).notes).toEqual([]);
});
it('does not treat an unreadable duplicate filename as an unambiguous link', async () => {
  const source = path.join(root, 'source.md');
  await writeFile(source, '# 来源');
  await mkdir(path.join(root, 'other'));
  await writeFile(path.join(root, 'sub', 'target.md'), '# 目标');
  await writeFile(path.join(root, 'other', 'target.md'), Buffer.from([255, 254, 0, 1]));
  const resolved = await store.resolveLink(source, 'target');
  expect(resolved.path).toBeNull();
  expect(resolved.candidates).toHaveLength(2);
  expect(resolved.issues).toHaveLength(1);
});
