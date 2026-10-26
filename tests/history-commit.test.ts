import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HistoryStore } from '../electron/storage/history';
import { defaultSettings } from '../src/shared/defaults';
import { hash } from '../electron/storage/io';

const fault = vi.hoisted(() => ({ index: '' }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      if (to === fault.index) throw new Error('generated index failure');
      return fs.rename(from, to);
    },
  };
});
let directory = '';
afterEach(async () => {
  fault.index = '';
  if (directory) await rm(directory, { recursive: true, force: true });
});
it('retains the previously committed snapshot and hash when a coalesced index commit fails', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-history-commit-'));
  const file = path.join(directory, 'note.md');
  await writeFile(file, 'old');
  const make = () =>
    new HistoryStore({
      directory,
      settings: () => defaultSettings,
      now: () => 1800000000000,
      resolveAsset: async () => {
        throw new Error('no assets');
      },
    });
  const store = make();
  await store.initialize();
  await store.snapshot(file, 'old', '编辑后', true);
  const before = store.list(file)[0];
  fault.index = path.join(directory, 'history', 'index.json');
  await expect(store.snapshot(file, 'new', '编辑后', true)).rejects.toThrow(
    'generated index failure',
  );
  expect((await store.read(before.id)).content).toBe('old');
  const reopened = make();
  await reopened.initialize();
  expect((await reopened.read(before.id)).content).toBe('old');
  const index = JSON.parse(await readFile(fault.index, 'utf8'));
  expect(index[0].contentHash).toBe(hash('old'));
  fault.index = '';
  await store.snapshot(file, 'new', '编辑后', true);
  expect(store.list(file)).toHaveLength(1);
  expect((await store.read(store.list(file)[0].id)).content).toBe('new');
});
