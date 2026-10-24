import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FontManager } from '../electron/resources/fonts';

const fault = vi.hoisted(() => ({ unlink: '', manifest: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    unlink: async (file: string) => {
      if (String(file) === fault.unlink)
        throw Object.assign(new Error('生成字体被占用'), { code: 'EACCES' });
      return actual.unlink(file);
    },
    rename: async (from: string, to: string) => {
      if (String(to) === fault.manifest)
        throw Object.assign(new Error('生成清单写入失败'), { code: 'EACCES' });
      return actual.rename(from, to);
    },
  };
});

describe('managed font mutations keep their manifest and files consistent', () => {
  let directory: string;
  let profile: string;
  let manager: FontManager;
  const bytes = new Uint8Array([0, 1, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0]);
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-font-manager-'));
    profile = path.join(directory, 'profile');
    const source = path.join(directory, 'generated.ttf');
    await writeFile(source, bytes);
    manager = new FontManager(profile, {
      selectFiles: async () => [source],
      assetUrl: async (file) => `fixture:${path.basename(file)}`,
      progress() {},
      fetch: async () => new Response(bytes),
    });
  });
  afterEach(async () => {
    fault.unlink = '';
    fault.manifest = '';
    await rm(directory, { recursive: true, force: true });
  });
  it('retains every successful overlapping import instead of losing manifest entries', async () => {
    const accepted = (await Promise.all([manager.importFonts(), manager.importFonts()])).flat();
    const managed = await manager.managedFonts();
    expect(managed.map((font) => font.id).sort()).toEqual(accepted.map((font) => font.id).sort());
    expect(
      (await readdir(path.join(profile, 'fonts'))).filter((name) => name.endsWith('.ttf')),
    ).toHaveLength(2);
  });
  it('coordinates downloaded and imported font commits using the same manifest', async () => {
    const accepted = (
      await Promise.all([manager.importFonts(), manager.downloadFont('fira-code')])
    ).flat();
    const managed = await manager.managedFonts();
    expect(managed.map((font) => font.id).sort()).toEqual(accepted.map((font) => font.id).sort());
    expect(managed.map((font) => font.source).sort()).toEqual(['downloaded', 'imported']);
  });
  it('coordinates removal and a new import without resurrecting the removed record or losing the new one', async () => {
    const [old] = await manager.importFonts();
    const [added] = await Promise.all([manager.importFonts(), manager.removeFont(old.id)]);
    expect((await manager.managedFonts()).map((font) => font.id)).toEqual([added[0].id]);
    await expect(readFile(old.path!)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains the record and original file when deleting the font file fails', async () => {
    const [entry] = await manager.importFonts();
    fault.unlink = entry.path!;
    await expect(manager.removeFont(entry.id)).rejects.toThrow('生成字体被占用');
    fault.unlink = '';
    expect((await manager.managedFonts()).map((font) => font.id)).toEqual([entry.id]);
    expect(await readFile(entry.path!)).toEqual(Buffer.from(bytes));
  });
  it('removes an unindexed new file on manifest failure and continues accepting later operations', async () => {
    fault.manifest = path.join(profile, 'fonts', 'manifest.json');
    await expect(manager.importFonts()).rejects.toThrow('生成清单写入失败');
    expect(
      (await readdir(path.join(profile, 'fonts'))).filter((name) => name.endsWith('.ttf')),
    ).toEqual([]);
    fault.manifest = '';
    const [entry] = await manager.importFonts();
    expect((await manager.managedFonts()).map((font) => font.id)).toEqual([entry.id]);
  });
});
