import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { HistoryStore } from '../electron/storage/history';
import { defaultSettings } from '../src/shared/defaults';
const observed = vi.hoisted(() => ({ path: '', stats: 0 }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    stat: async (...args: Parameters<typeof fs.stat>) => {
      if (String(args[0]) === observed.path) observed.stats++;
      return fs.stat(...args);
    },
  };
});
it('checks each note once while keeping the newest and pinned versions over capacity', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-prune-'));
  try {
    const file = path.join(dir, 'note.md');
    await writeFile(file, 'current');
    observed.path = file;
    observed.stats = 0;
    const now = Date.now();
    const entries = Array.from({ length: 60 }, (_, i) => ({
      id: randomUUID(),
      path: file,
      createdAt: now - i,
      pinned: i === 59,
      reason: '测试',
      textBytes: 700000,
      imageBytes: 0,
      images: [],
      contentHash: String(i),
    }));
    await mkdir(path.join(dir, 'history'), { recursive: true });
    await writeFile(path.join(dir, 'history', 'index.json'), JSON.stringify(entries));
    const history = new HistoryStore({
      directory: dir,
      settings: () => ({ ...defaultSettings, historyLimitMB: 1 }),
      now: () => now,
      resolveAsset: async () => {
        throw Error('no assets');
      },
    });
    await history.initialize();
    const result = await history.prune();
    expect(observed.stats).toBe(1);
    expect(
      history
        .list(file)
        .map((e) => e.id)
        .sort(),
    ).toEqual([entries[0].id, entries[59].id].sort());
    expect(result.warning).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
