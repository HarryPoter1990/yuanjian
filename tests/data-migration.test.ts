import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DATA_NAME,
  LEGACY_DATA_NAME,
  migrateDataDirectory,
} from '../electron/resources/data-migration';
const fault = vi.hoisted(() => ({ locked: '' }));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (String(args[0]) === fault.locked)
        throw Object.assign(new Error(`resource busy or locked, open '${fault.locked}'`), {
          code: 'EBUSY',
        });
      return actual.readFile(...args);
    },
  };
});
let root: string, original: string, target: string;
beforeEach(async () => {
  fault.locked = '';
  root = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-migration-'));
  original = path.join(root, LEGACY_DATA_NAME);
  target = path.join(root, DATA_NAME);
});
afterEach(async () => {
  fault.locked = '';
  await rm(root, { recursive: true, force: true });
});
it('creates the new default on a first run without inventing legacy data', async () => {
  expect(await migrateDataDirectory(root)).toEqual({
    directory: target,
    migrated: false,
    warnings: [],
  });
  expect(await readdir(root)).toEqual([DATA_NAME]);
});
it('copies verified settings/history/drafts and rebases only managed font/wallpaper paths', async () => {
  await mkdir(path.join(original, 'fonts'), { recursive: true });
  await mkdir(path.join(original, 'history'));
  const font = path.join(original, 'fonts', '生成字体.woff2');
  await writeFile(font, 'generated-font-bytes');
  await writeFile(path.join(original, 'wall.png'), 'generated-image');
  const manifest = JSON.stringify([
    { id: 'font', name: '生成字体', path: font, source: 'imported' },
  ]);
  await writeFile(path.join(original, 'fonts', 'manifest.json'), manifest);
  const settings = JSON.stringify({
    roots: ['D:/user/轻笺笔记'],
    appearance: { wallpaper: path.join(original, 'wall.png') },
    themes: [{ appearance: { wallpaper: 'D:/user/keep.png' } }],
  });
  await writeFile(path.join(original, 'settings.json'), settings);
  await writeFile(path.join(original, 'session.json'), '含有轻笺字样的用户草稿，不可全局替换');
  await writeFile(path.join(original, 'history', '旧版.md'), '原文\r\n');
  const result = await migrateDataDirectory(root);
  expect(result.directory).toBe(target);
  expect(result.migrated).toBe(true);
  expect(await readFile(path.join(original, 'settings.json'), 'utf8')).toBe(settings);
  expect(await readFile(path.join(original, 'fonts', 'manifest.json'), 'utf8')).toBe(manifest);
  expect(await readFile(path.join(target, 'fonts', '生成字体.woff2'), 'utf8')).toBe(
    'generated-font-bytes',
  );
  expect(
    JSON.parse(await readFile(path.join(target, 'fonts', 'manifest.json'), 'utf8'))[0].path,
  ).toBe(path.join(target, 'fonts', '生成字体.woff2'));
  const migrated = JSON.parse(await readFile(path.join(target, 'settings.json'), 'utf8'));
  expect(migrated.appearance.wallpaper).toBe(path.join(target, 'wall.png'));
  expect(migrated.roots).toEqual(['D:/user/轻笺笔记']);
  expect(migrated.themes[0].appearance.wallpaper).toBe('D:/user/keep.png');
  expect(await readFile(path.join(target, 'session.json'), 'utf8')).toBe(
    '含有轻笺字样的用户草稿，不可全局替换',
  );
  expect(await readFile(path.join(target, 'history', '旧版.md'), 'utf8')).toBe('原文\r\n');
  expect((await migrateDataDirectory(root)).migrated).toBe(false);
});
it('never merges or overwrites an existing destination', async () => {
  await mkdir(original);
  await mkdir(target);
  await writeFile(path.join(original, 'settings.json'), 'old');
  await writeFile(path.join(target, 'settings.json'), 'new');
  const result = await migrateDataDirectory(root);
  expect(result.directory).toBe(target);
  expect(result.migrated).toBe(false);
  expect(await readFile(path.join(target, 'settings.json'), 'utf8')).toBe('new');
  expect(await readFile(path.join(original, 'settings.json'), 'utf8')).toBe('old');
});
it('retains the legacy data and removes only its owned stage when publication fails', async () => {
  await mkdir(original);
  await writeFile(path.join(original, 'session.json'), 'generated-draft');
  vi.mocked(rename).mockRejectedValueOnce(
    Object.assign(new Error('generated publish failure'), { code: 'EACCES' }),
  );
  const result = await migrateDataDirectory(root);
  expect(result.directory).toBe(original);
  expect(result.warnings.join('')).toContain('generated publish failure');
  expect(await readFile(path.join(original, 'session.json'), 'utf8')).toBe('generated-draft');
  expect(await readdir(root)).toEqual([LEGACY_DATA_NAME]);
});
it('preserves another destination that appears just before publication', async () => {
  await mkdir(original);
  await writeFile(path.join(original, 'session.json'), 'legacy-draft');
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockImplementationOnce(async (from, to) => {
    await mkdir(target);
    await writeFile(path.join(target, 'session.json'), 'other-draft');
    await actual.rename(from, to);
  });
  const result = await migrateDataDirectory(root);
  expect(result.migrated).toBe(false);
  expect(await readFile(path.join(original, 'session.json'), 'utf8')).toBe('legacy-draft');
  expect(await readFile(path.join(target, 'session.json'), 'utf8')).toBe('other-draft');
});
it('refuses a corrupt managed-font index and retains the old directory without a partial target', async () => {
  await mkdir(path.join(original, 'fonts'), { recursive: true });
  await writeFile(
    path.join(original, 'fonts', 'manifest.json'),
    JSON.stringify([{ path: path.join(root, 'outside.woff2') }]),
  );
  const result = await migrateDataDirectory(root);
  expect(result.directory).toBe(original);
  expect(result.warnings.join('')).toContain('位置无法核对');
  expect((await readdir(root)).sort()).toEqual([LEGACY_DATA_NAME]);
});
it('does not traverse a junction or copy data outside the legacy directory', async () => {
  await mkdir(original);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'private.md'), 'do not copy');
  await symlink(
    outside,
    path.join(original, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = await migrateDataDirectory(root);
  expect(result.directory).toBe(original);
  expect(result.warnings.join('')).toContain('含链接');
  expect(await readFile(path.join(outside, 'private.md'), 'utf8')).toBe('do not copy');
  expect((await readdir(root)).sort()).toEqual(['outside', LEGACY_DATA_NAME].sort());
});
it('skips regenerable runtime caches while retaining unknown user data', async () => {
  await mkdir(path.join(original, 'Cache'), { recursive: true });
  await writeFile(path.join(original, 'Cache', 'cache'), 'cache');
  await writeFile(path.join(original, 'unknown-user-data.bin'), 'must preserve');
  expect((await migrateDataDirectory(root)).migrated).toBe(true);
  expect(await readdir(target)).toEqual(['unknown-user-data.bin']);
  expect(await readFile(path.join(original, 'Cache', 'cache'), 'utf8')).toBe('cache');
});
it('does not read a locked GPUPersistentCache database while migrating user settings and drafts', async () => {
  const cache = path.join(
    original,
    'GPUPersistentCache',
    'DawnGraphiteCache',
    'generated-cache-key',
    'cache.db',
  );
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, 'generated GPU cache');
  await writeFile(path.join(original, 'settings.json'), '{}');
  await writeFile(path.join(original, 'session.json'), 'generated unsaved draft');
  fault.locked = cache;
  await expect(readFile(cache)).rejects.toMatchObject({ code: 'EBUSY' });
  const result = await migrateDataDirectory(root);
  expect(result.migrated).toBe(true);
  expect(result.directory).toBe(target);
  expect(await readdir(target)).not.toContain('GPUPersistentCache');
  expect(await readFile(path.join(target, 'session.json'), 'utf8')).toBe('generated unsaved draft');
  expect(await readFile(path.join(original, 'session.json'), 'utf8')).toBe(
    'generated unsaved draft',
  );
  fault.locked = '';
  expect(await readFile(cache, 'utf8')).toBe('generated GPU cache');
});
it('still retains the original directory when a locked user file cannot be copied and verified', async () => {
  const userFile = path.join(original, 'MyCache', 'user-state.db');
  await mkdir(path.dirname(userFile), { recursive: true });
  await writeFile(userFile, 'generated user data, not Chromium cache');
  fault.locked = userFile;
  const result = await migrateDataDirectory(root);
  expect(result.migrated).toBe(false);
  expect(result.directory).toBe(original);
  expect(result.warnings.join(' ')).toContain('resource busy or locked');
  expect(await readdir(root)).toEqual([LEGACY_DATA_NAME]);
  fault.locked = '';
  expect(await readFile(userFile, 'utf8')).toBe('generated user data, not Chromium cache');
});
