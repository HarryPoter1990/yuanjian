import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';
import { mergeOpenSearch, searchDocument } from '../src/shared/search';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-search-'));
  dirs.push(dir);
  const a = path.join(dir, 'a'),
    b = path.join(dir, 'b');
  await mkdir(a);
  await mkdir(b);
  const store = new NoteStore(path.join(dir, 'profile'));
  await store.initialize();
  await store.approveDirectory(a);
  await store.approveDirectory(b);
  await store.saveSettings({ ...store.getSettings(), roots: [a, b] });
  return { store, a, b };
}
it('keeps long-line matches in snippets and reads each scoped note only once', async () => {
  const { store, a, b } = await fixture();
  await writeFile(path.join(a, 'long.md'), '甲'.repeat(450) + '目标');
  await writeFile(path.join(b, 'bad.md'), Buffer.from([255, 254]));
  const read = vi.spyOn(store, 'readNote');
  const page = await store.searchNotes('目标', { root: a });
  expect(page.notes).toHaveLength(1);
  expect(page.notes[0].matches[0].snippet).toContain('目标');
  expect(page.issues).toEqual([]);
  expect(read).toHaveBeenCalledTimes(1);
  const all = await store.searchNotes('目标');
  expect(all.notes).toHaveLength(1);
  expect(all.issues).toHaveLength(1);
  expect(all.issues[0].path).toContain('bad.md');
  await store.dispose();
});
it('groups many line hits without hiding later matching notes', async () => {
  const { store, a } = await fixture();
  await writeFile(path.join(a, 'one.md'), '目标\n'.repeat(3100));
  await writeFile(path.join(a, 'two.md'), '目标\n');
  const page = await store.searchNotes('目标');
  expect(page.notes).toHaveLength(2);
  expect(page.notes.find((note) => note.path?.endsWith('one.md'))?.matchCount).toBe(3100);
  expect(page.notes.find((note) => note.path?.endsWith('two.md'))).toBeTruthy();
  await store.dispose();
});
it('supports multi-term AND, quoted phrases, Chinese and title priority', async () => {
  const { store, a } = await fixture();
  await writeFile(path.join(a, 'body.md'), 'Java 学习\n一个接口');
  await writeFile(path.join(a, 'title.md'), '# Java 接口\n资料');
  const page = await store.searchNotes('Java 接口');
  expect(page.notes).toHaveLength(2);
  expect(page.notes[0].title).toBe('Java 接口');
  expect((await store.searchNotes('"Java 接口"')).notes).toHaveLength(1);
  await store.dispose();
});
it('cancels an obsolete scan between reads', async () => {
  const { store, a } = await fixture();
  await writeFile(path.join(a, 'one.md'), '目标');
  await writeFile(path.join(a, 'two.md'), '目标');
  const real = store.readNote.bind(store);
  let reads = 0;
  vi.spyOn(store, 'readNote').mockImplementation(async (file) => {
    reads++;
    await store.cancelSearch('request');
    return real(file);
  });
  const page = await store.searchNotes('目标', { requestId: 'request' });
  expect(page.cancelled).toBe(true);
  expect(reads).toBe(1);
  await store.dispose();
});
it('uses an open edited version once, includes drafts, and scopes saved paths strictly', () => {
  const page = {
    notes: [
      searchDocument('目标', { path: 'D:/notes/a.md', title: 'a', content: '旧目标', tags: [] })!,
    ],
    issues: [],
    truncated: false,
  };
  const tabs = [
    { id: 'open', path: 'D:/notes/a.md', title: 'a', content: '已删词', dirty: true },
    { id: 'draft', path: null, title: '草稿', content: '目标', dirty: true },
    { id: 'other', path: 'D:/notes-archive/b.md', title: 'b', content: '目标', dirty: false },
  ];
  expect(new Set(mergeOpenSearch(page, '目标', tabs, '').notes.map((note) => note.id))).toEqual(
    new Set(['other', 'draft']),
  );
  expect(mergeOpenSearch(page, '目标', tabs, 'D:/notes').notes).toEqual([]);
});
