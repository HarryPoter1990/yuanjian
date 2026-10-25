import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, truncate } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { TransferService } from '../electron/resources/import';
import { NoteStore } from '../electron/storage/store';
import * as access from '../electron/storage/access';
import * as io from '../electron/storage/io';
import type { ImportSource, TransferItem } from '../src/shared/types';
let base: string, sourceDir: string, targetDir: string, store: NoteStore, service: TransferService;
let chosen: string | null = null;
beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-import-'));
  sourceDir = path.join(base, '来源');
  targetDir = path.join(base, '保存');
  await mkdir(sourceDir);
  await mkdir(targetDir);
  store = new NoteStore(path.join(base, 'data'), {
    saveFile: async () => chosen,
    prepareSave: (request, target) => service.prepareSave(request, target),
  });
  await store.initialize();
  service = new TransferService(store, { chooseFiles: async () => [] });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await store.dispose();
  await rm(base, { recursive: true, force: true });
});
const getSource = (item: TransferItem): ImportSource => {
  expect(item.kind).toBe('source');
  if (item.kind !== 'source') throw Error('No import source');
  return item.source;
};
async function html(text: string) {
  const file = path.join(sourceDir, '文章.html');
  await writeFile(file, text);
  return getSource((await service.preparePaths([file]))[0]);
}
describe('selected file transfer and persisted import origin', () => {
  it.each([false, true])(
    'rejects an outside canonical destination before reading or granting it, hashed=%s',
    async (hashed) => {
      const bytes = 'same-image';
      await writeFile(path.join(sourceDir, 'picture.png'), bytes);
      const outside = path.join(base, 'private.png');
      await writeFile(outside, bytes);
      await mkdir(path.join(targetDir, 'assets'));
      if (hashed) await writeFile(path.join(targetDir, 'assets', 'picture.png'), 'other-image');
      const name = hashed
        ? `picture-${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}.png`
        : 'picture.png';
      const destination = path.join(targetDir, 'assets', name);
      await writeFile(destination, bytes);
      const realCanonical = access.canonical;
      vi.spyOn(access, 'canonical').mockImplementation((candidate) =>
        path.resolve(candidate) === destination
          ? Promise.resolve(outside)
          : realCanonical(candidate),
      );
      const source = await html('<img src="picture.png">');
      chosen = path.join(targetDir, 'saved.md');
      const reads = vi.spyOn(io, 'readOptional');
      const grants = vi.spyOn(store, 'approveFile');
      const result = await store.saveFile({
        path: null,
        content: '![图](picture.png)',
        baseContent: '',
        hash: '',
        title: 'saved',
        importSourceId: source.id,
      });
      expect(reads.mock.calls.some(([file]) => file === outside || file === destination)).toBe(
        false,
      );
      expect(grants.mock.calls.some(([file]) => file === outside || file === destination)).toBe(
        false,
      );
      await expect(store.authorize(outside)).rejects.toThrow(/授权/);
      expect(result.notices?.join('')).toMatch(/越出|越界/);
      expect(await readFile(outside, 'utf8')).toBe(bytes);
    },
  );
  it('rejects a real directory junction at the destination before reading it', async () => {
    await writeFile(path.join(sourceDir, 'picture.png'), 'image');
    const outside = path.join(base, 'private-dir');
    await mkdir(outside);
    await writeFile(path.join(outside, 'private.txt'), 'generated');
    await mkdir(path.join(targetDir, 'assets'));
    await symlink(outside, path.join(targetDir, 'assets', 'picture.png'), 'junction');
    const source = await html('<img src="picture.png">');
    chosen = path.join(targetDir, 'saved.md');
    const result = await store.saveFile({
      path: null,
      content: '![图](picture.png)',
      baseContent: '',
      hash: '',
      title: 'saved',
      importSourceId: source.id,
    });
    expect(result.notices?.join('')).toMatch(/越出|越界/);
    await expect(store.authorize(outside)).rejects.toThrow(/授权/);
  });
  it('refuses an over-limit preview image before reading its payload', async () => {
    const image = path.join(sourceDir, 'large.png');
    await writeFile(image, 'x');
    await truncate(image, 25 * 1024 * 1024 + 1);
    const source = await html('<img src="large.png">');
    await expect(service.resolveAsset(source.id, 'large.png')).rejects.toThrow(/25 MiB/);
  });
  it('routes Markdown, TXT, folders, images and per-file errors without modifying originals', async () => {
    const md = path.join(sourceDir, '笔记.md'),
      txt = path.join(sourceDir, '纯文.txt'),
      image = path.join(sourceDir, '图.png'),
      other = path.join(sourceDir, '文档.docx');
    await writeFile(md, '\ufeff# 正文\r\n');
    await writeFile(txt, '中文\r\n');
    await writeFile(image, 'image');
    await writeFile(other, 'unsupported');
    const result = await service.preparePaths([
      md,
      txt,
      sourceDir,
      image,
      other,
      path.join(sourceDir, 'missing.md'),
    ]);
    expect(result.map((value) => value.kind)).toEqual([
      'note',
      'note',
      'directory',
      'image',
      'error',
      'error',
    ]);
    expect(await readFile(md, 'utf8')).toBe('\ufeff# 正文\r\n');
    expect(await readFile(txt, 'utf8')).toBe('中文\r\n');
  });
  it('reads native chooser selections and preserves duplicate result feedback', async () => {
    const file = path.join(sourceDir, 'table.csv');
    await writeFile(file, '名,值\n甲,1');
    const picker = new TransferService(store, { chooseFiles: async () => [file] });
    const result = await picker.chooseImports();
    expect(getSource(result[0]).text).toContain('甲,1');
  });
  it('persists an opaque origin and reopens it after a service restart with decoding choice', async () => {
    const source = await html('<p>中文</p>');
    const restarted = new TransferService(store, { chooseFiles: async () => [] });
    expect((await restarted.readImport(source.id, 'utf-8')).text).toBe('<p>中文</p>');
    await expect(restarted.readImport('forged-source', 'utf-8')).rejects.toThrow(/来源/);
  });
  it('detects changed source bytes and refuses using its old authority', async () => {
    const source = await html('<img src="picture.png">');
    await writeFile(source.path, '<img src="different.png">');
    await expect(service.readImport(source.id, 'utf-8')).rejects.toThrow(/外部改变/);
    await expect(service.resolveAsset(source.id, 'picture.png')).rejects.toThrow(/外部改变/);
  });
  it('decodes BOM UTF-16 table sources and keeps undecodable option errors explicit', async () => {
    const file = path.join(sourceDir, '表.csv');
    await writeFile(
      file,
      Buffer.concat([Buffer.from([255, 254]), Buffer.from('名字,数值\r\n甲,1', 'utf16le')]),
    );
    const source = getSource((await service.preparePaths([file]))[0]);
    expect(source.encoding).toBe('utf-16le');
    expect(source.text).toContain('名字');
    await expect(service.readImport(source.id, 'utf-8')).rejects.toThrow(/解码/);
  });
  it('resolves only original source image references, including encoded spaces, within the original directory', async () => {
    await writeFile(path.join(sourceDir, 'a b.png'), 'image');
    await writeFile(path.join(base, 'outside.png'), 'outside');
    const source = await html('<img src="a b.png"><img src="../outside.png">');
    expect(await service.resolveAsset(source.id, 'a%20b.png')).toBe(
      path.join(sourceDir, 'a b.png'),
    );
    await expect(service.resolveAsset(source.id, 'not-listed.png')).rejects.toThrow(/原始 HTML/);
    await expect(service.resolveAsset(source.id, '../outside.png')).rejects.toThrow(/越出/);
  });
  it('copies only referenced images on first save, preserves collisions and adjusts local links', async () => {
    await writeFile(path.join(sourceDir, 'picture.png'), 'old-image');
    await writeFile(path.join(sourceDir, 'unused.png'), 'unused');
    await writeFile(path.join(sourceDir, 'target.md'), '# 链接');
    await mkdir(path.join(targetDir, 'assets'));
    await writeFile(path.join(targetDir, 'assets', 'picture.png'), 'current-image');
    const source = await html(
      '<img src="picture.png"><img src="unused.png"><a href="target.md#h">链接</a>',
    );
    chosen = path.join(targetDir, 'saved.md');
    const outcome = await store.saveFile({
      path: null,
      content: '![图](picture.png)\n\n[链接](target.md#h)',
      baseContent: '',
      hash: '',
      title: 'saved',
      importSourceId: source.id,
    });
    expect(outcome.status).toBe('saved');
    expect(outcome.note!.content).toMatch(/assets\/picture-[\da-f]{10}\.png/);
    expect(outcome.note!.content).toContain('../%E6%9D%A5%E6%BA%90/target.md#h');
    expect(await readFile(path.join(sourceDir, 'picture.png'), 'utf8')).toBe('old-image');
    expect(await readFile(path.join(targetDir, 'assets', 'picture.png'), 'utf8')).toBe(
      'current-image',
    );
    await expect(readFile(path.join(targetDir, 'assets', 'unused.png'))).rejects.toThrow();
  });
  it('keeps missing image references and reports the failure without silently losing text', async () => {
    const source = await html('<img src="missing.png">');
    chosen = path.join(targetDir, 'saved.md');
    const outcome = await store.saveFile({
      path: null,
      content: '正文 ![缺失](missing.png)',
      baseContent: '',
      hash: '',
      title: 'saved',
      importSourceId: source.id,
    });
    expect(outcome.status).toBe('saved');
    expect(outcome.note!.content).toContain('正文 ![缺失](missing.png)');
    expect(outcome.notices?.join('')).toContain('未整理');
  });
  it('retains the existing new-file conflict boundary before copying import attachments', async () => {
    await writeFile(path.join(sourceDir, 'picture.png'), 'image');
    const source = await html('<img src="picture.png">');
    chosen = path.join(targetDir, 'existing.md');
    await writeFile(chosen, '原有笔记');
    const outcome = await store.saveFile({
      path: null,
      content: '![图](picture.png)',
      baseContent: '',
      hash: '',
      title: 'saved',
      importSourceId: source.id,
    });
    expect(outcome.status).toBe('conflict');
    expect(await readFile(chosen, 'utf8')).toBe('原有笔记');
    await expect(readFile(path.join(targetDir, 'assets', 'picture.png'))).rejects.toThrow();
  });
  it('preserves BOM and CRLF when editing an opened TXT file', async () => {
    const file = path.join(sourceDir, 'original.txt');
    await writeFile(file, '\ufeff甲\r\n乙\r\n');
    const result = (await service.preparePaths([file]))[0];
    if (result.kind !== 'note') throw Error('Not a note');
    await store.saveFile({
      path: file,
      content: '改\n乙\n',
      baseContent: result.note.content,
      hash: result.note.hash,
      title: 'original',
    });
    expect(await readFile(file, 'utf8')).toBe('\ufeff改\r\n乙\r\n');
  });
});
