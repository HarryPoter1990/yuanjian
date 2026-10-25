import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

describe('additional periodic notes', () => {
  let sandbox: string;
  let journal: string;
  let store: NoteStore;
  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-periodic-'));
    journal = path.join(sandbox, '我的日记');
    await mkdir(journal);
    store = new NoteStore(path.join(sandbox, 'data'));
    await store.initialize();
    await store.approveDirectory(journal);
    await store.saveSettings({ ...store.getSettings(), journalDirectory: journal });
  });
  afterEach(async () => {
    await store.dispose();
    await rm(sandbox, { recursive: true, force: true });
  });
  it('adds a separate same-day note while ordinary navigation keeps opening the base note', async () => {
    const base = (await store.periodicNote('daily', '2026-10-22'))!;
    await writeFile(base.path!, '# 第一天的原文');
    const additional = (await store.periodicNote('daily', '2026-10-22', undefined, true))!;
    expect(additional.path).toBe(path.join(journal, '2026', '10', '2026-10-22-2.md'));
    expect((await store.periodicNote('daily', '2026-10-22'))?.path).toBe(base.path);
    expect(await readFile(base.path!, 'utf8')).toBe('# 第一天的原文');
  });
  it('skips existing numbered collisions and uses the explicitly selected template in Chinese directories', async () => {
    const settings = store.getSettings();
    await store.saveSettings({
      ...settings,
      dailyPattern: '中文年份/{{year}}/{{date}}.md',
      templates: [
        {
          id: 'study',
          name: '学习日记',
          kind: 'daily',
          content: '# 学习 {{date}}\n\n代码：`\\n`\n',
        },
        { id: 'life', name: '生活日记', kind: 'daily', content: '# 生活 {{date}}\n\n记录生活\n' },
      ],
    });
    const base = (await store.periodicNote('daily', '2026-10-22', 'study'))!;
    const collision = path.join(path.dirname(base.path!), '2026-10-22-2.md');
    await writeFile(collision, '已经存在的第二篇');
    const next = (await store.periodicNote('daily', '2026-10-22', 'life', true))!;
    expect(next.path).toBe(path.join(journal, '中文年份', '2026', '2026-10-22-3.md'));
    expect(next.content).toBe('# 生活 2026-10-22\n\n记录生活\n');
    expect(await readFile(collision, 'utf8')).toBe('已经存在的第二篇');
    expect(await readFile(base.path!, 'utf8')).toContain('`\\n`');
  });
  it('creates different numbered files for concurrent additional-note requests', async () => {
    await store.periodicNote('daily', '2026-10-22');
    const notes = await Promise.all(
      Array.from({ length: 3 }, () => store.periodicNote('daily', '2026-10-22', undefined, true)),
    );
    expect(notes.map((note) => path.basename(note!.path!)).sort()).toEqual([
      '2026-10-22-2.md',
      '2026-10-22-3.md',
      '2026-10-22-4.md',
    ]);
    expect(new Set(notes.map((note) => note!.path)).size).toBe(3);
  });
});
