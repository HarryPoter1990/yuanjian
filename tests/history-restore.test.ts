import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';
import { extractLinks } from '../src/shared/markdown';
import { hash } from '../electron/storage/io';

describe('history restores preserve current resources and relocate references', () => {
  let sandbox: string;
  let notes: string;
  let store: NoteStore;
  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-restore-'));
    notes = path.join(sandbox, '中文笔记');
    await mkdir(path.join(notes, 'assets'), { recursive: true });
    store = new NoteStore(path.join(sandbox, 'profile'));
    await store.initialize();
    await store.approveDirectory(notes);
    await store.saveSettings({ ...store.getSettings(), roots: [notes] });
  });
  afterEach(async () => {
    await store.dispose();
    await rm(sandbox, { recursive: true, force: true });
  });
  async function edit(file: string, content: string) {
    const note = (await store.openFile(file))!;
    const saved = await store.saveFile({
      path: file,
      content,
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    expect(saved.status).toBe('saved');
    return (await store.listHistory(file)).find((entry) => entry.reason === '修改前基线')!;
  }
  async function imageTargets(file: string, content: string) {
    return Promise.all(
      extractLinks(content)
        .filter((link) => link.image)
        .map((link) => store.resolveAssetPath(link.target, file)),
    );
  }
  async function restartWithLegacyIndex() {
    await store.dispose();
    const indexFile = path.join(sandbox, 'profile', 'history', 'index.json');
    const index = JSON.parse(await readFile(indexFile, 'utf8'));
    for (const entry of index) {
      delete entry.sourcePath;
      for (const image of entry.images) delete image.targets;
    }
    await writeFile(indexFile, JSON.stringify(index));
    store = new NoteStore(path.join(sandbox, 'profile'));
    await store.initialize();
  }

  it('keeps a newer shared image and restores old bytes to a suffixed file referenced only by the restored note', async () => {
    const file = path.join(notes, 'A.md');
    const other = path.join(notes, 'B.md');
    const image = path.join(notes, 'assets', '共享 图.png');
    const old = Buffer.from([1, 2, 3]);
    const current = Buffer.from([7, 8, 9]);
    await writeFile(image, old);
    await writeFile(file, '![旧图](assets/共享%20图.png)\n');
    const baseline = await edit(file, 'A 不再引用图片\n');
    const otherText = '![共享图](assets/共享%20图.png)\n';
    await writeFile(other, otherText);
    await writeFile(image, current);
    const restored = await store.restoreHistory(baseline.id);
    expect(await readFile(image)).toEqual(current);
    expect(await readFile(other, 'utf8')).toBe(otherText);
    const [target] = await imageTargets(file, restored.content);
    expect(target).not.toBe(image);
    expect(path.basename(target)).toMatch(/^共享 图-restored-/);
    expect(await readFile(target)).toEqual(old);
    expect((await store.listHistory(file)).some((entry) => entry.reason === '恢复前')).toBe(true);
  });

  it('reuses an existing identical image without creating a second copy', async () => {
    const file = path.join(notes, 'A.md');
    const image = path.join(notes, 'assets', '图.png');
    await writeFile(image, Buffer.from([1, 2, 3]));
    await writeFile(file, '![图](assets/图.png)\n');
    const baseline = await edit(file, '当前文字');
    const restored = await store.restoreHistory(baseline.id);
    expect(await imageTargets(file, restored.content)).toEqual([image]);
    expect(await readdir(path.dirname(image))).toEqual(['图.png']);
  });

  it('restores at the current note position after a move, including reference images, wiki images and ordinary links', async () => {
    const source = path.join(notes, '原文.md');
    const destination = path.join(notes, '子目录', '新名.md');
    const image = path.join(notes, 'assets', '同名.png');
    await mkdir(path.join(notes, 'other'));
    await writeFile(image, Buffer.from([1, 2, 3]));
    await writeFile(path.join(notes, 'other', '同名.png'), Buffer.from([4, 5, 6]));
    await writeFile(path.join(notes, '目标.md'), '# 目标\n');
    const literal =
      '```md\r\n![代码中的图片](assets/同名.png)\r\n[代码中的链接](目标.md)\r\n```\r\n';
    const original =
      '\ufeff# 原文\r\n![行内](assets/同名.png)\r\n![重复](assets/同名.png)\r\n![引用][img]\r\n![[assets/同名.png]]\r\n[目标](目标.md#标题)\r\n[[原文#自身]]\r\n\r\n[img]: assets/同名.png "原有标题"\r\n\r\n' +
      literal;
    await writeFile(source, original);
    const baseline = await edit(source, original.replace('原文\r\n', '编辑后\r\n').slice(1));
    await store.moveFile(source, destination);
    const restored = await store.restoreHistory(baseline.id);
    const targets = await imageTargets(destination, restored.content);
    expect(targets).toHaveLength(4);
    expect(targets.every((target) => target === image)).toBe(true);
    expect(restored.content).toContain('[目标](../目标.md#标题)');
    expect(restored.content).toContain('[[新名#自身]]');
    expect(restored.content).toContain('"原有标题"');
    expect(restored.content).toContain(literal);
    const bytes = await readFile(destination, 'utf8');
    expect(bytes.startsWith('\ufeff')).toBe(true);
    expect(bytes.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('never overwrites a competing suffixed file and reuses an identical recovered copy on another restore', async () => {
    const file = path.join(notes, 'A.md');
    const image = path.join(notes, 'assets', '图.png');
    const old = Buffer.from([1, 2, 3]);
    await writeFile(image, old);
    await writeFile(file, '![图](assets/图.png)\n');
    const baseline = await edit(file, '新的文字');
    await writeFile(image, Buffer.from([7, 8, 9]));
    const collision = path.join(notes, 'assets', `图-restored-${hash(old).slice(0, 10)}.png`);
    await writeFile(collision, '其他内容');
    const first = await store.restoreHistory(baseline.id);
    expect(await readFile(image)).toEqual(Buffer.from([7, 8, 9]));
    expect(await readFile(collision, 'utf8')).toBe('其他内容');
    const [target] = await imageTargets(file, first.content);
    expect(await readFile(target)).toEqual(old);
    const before = await readdir(path.dirname(image));
    const second = await store.restoreHistory(baseline.id);
    expect(await imageTargets(file, second.content)).toEqual([target]);
    expect(await readdir(path.dirname(image))).toEqual(before);
  });

  it('matches different same-name images precisely in a moved 0.3.3 index and infers a consistent old directory', async () => {
    const source = path.join(notes, '原文.md');
    const destination = path.join(notes, '新位置', '新名.md');
    await mkdir(path.join(notes, 'a'));
    await mkdir(path.join(notes, 'b'));
    const firstImage = path.join(notes, 'a', '同名.png');
    const secondImage = path.join(notes, 'b', '同名.png');
    await writeFile(firstImage, Buffer.from([1]));
    await writeFile(secondImage, Buffer.from([2]));
    await writeFile(path.join(notes, '目标.md'), '# 目标');
    await writeFile(source, '![一](a/同名.png)\n![二](b/同名.png)\n[目标](目标.md)\n');
    const baseline = await edit(source, '当前内容');
    await store.moveFile(source, destination);
    await restartWithLegacyIndex();
    const restored = await store.restoreHistory(baseline.id);
    expect(await imageTargets(destination, restored.content)).toEqual([firstImage, secondImage]);
    expect(restored.content).toContain('[目标](../目标.md)');
    expect(await readFile(firstImage)).toEqual(Buffer.from([1]));
    expect(await readFile(secondImage)).toEqual(Buffer.from([2]));
  });

  it('refuses an ambiguous moved legacy image target while keeping the current note and both images untouched', async () => {
    const oldDirectory = path.join(notes, '旧位置');
    await mkdir(oldDirectory);
    await mkdir(path.join(notes, 'other'));
    const source = path.join(oldDirectory, 'A.md');
    const destination = path.join(notes, '新位置', 'A.md');
    const image = path.join(oldDirectory, '图.png');
    const other = path.join(notes, 'other', '图.png');
    await writeFile(image, Buffer.from([1]));
    await writeFile(other, Buffer.from([2]));
    await writeFile(source, '![一](图.png)\n![二](../other/图.png)\n');
    const baseline = await edit(source, '必须保留的当前文字');
    await store.moveFile(source, destination);
    await restartWithLegacyIndex();
    await expect(store.restoreHistory(baseline.id)).rejects.toThrow(/歧义.*已保留/);
    expect(await readFile(destination, 'utf8')).toBe('必须保留的当前文字');
    expect(await readFile(image)).toEqual(Buffer.from([1]));
    expect(await readFile(other)).toEqual(Buffer.from([2]));
  });

  it.each([
    '[目标](目标.md)\n',
    '[[目标]]\n',
    '[目标][ref]\n\n[ref]: 目标.md\n',
    '![图](图.png)\n[目标](目标.md)\n',
  ])(
    'refuses legacy relative note links without origin evidence instead of opening a different same-name note: %j',
    async (content) => {
      const oldDirectory = path.join(notes, '旧位置');
      const newDirectory = path.join(notes, '新位置');
      await mkdir(oldDirectory);
      await mkdir(newDirectory);
      const source = path.join(oldDirectory, 'A.md');
      const destination = path.join(newDirectory, 'A.md');
      const originalTarget = path.join(oldDirectory, '目标.md');
      const otherTarget = path.join(newDirectory, '目标.md');
      const image = path.join(oldDirectory, '图.png');
      await writeFile(image, Buffer.from([1, 2, 3]));
      await writeFile(originalTarget, '原目标');
      await writeFile(otherTarget, '另一份同名目标');
      await writeFile(source, content);
      const baseline = await edit(source, '必须保留的当前正文');
      await store.moveFile(source, destination);
      await writeFile(image, Buffer.from([7, 8, 9]));
      await restartWithLegacyIndex();
      const histories = await store.listHistory();
      const assets = await readdir(path.join(notes, 'assets'));
      const originals = await readdir(oldDirectory);
      await expect(store.restoreHistory(baseline.id)).rejects.toThrow(
        /旧版历史未记录原目录.*复制历史正文/,
      );
      expect(await readFile(destination, 'utf8')).toBe('必须保留的当前正文');
      expect(await readFile(originalTarget, 'utf8')).toBe('原目标');
      expect(await readFile(otherTarget, 'utf8')).toBe('另一份同名目标');
      expect(await readFile(image)).toEqual(Buffer.from([7, 8, 9]));
      expect(await readdir(oldDirectory)).toEqual(originals);
      expect(await store.listHistory()).toEqual(histories);
      expect(await readdir(path.join(notes, 'assets'))).toEqual(assets);
    },
  );

  it('restores legacy text with anchors, external links and code literals without requiring an old directory', async () => {
    const source = path.join(notes, 'A.md');
    const destination = path.join(notes, '新位置', 'A.md');
    const original =
      '\ufeff# 原文\r\n[段内](#原文)\r\n[网页](https://example.invalid/help)\r\n\r\n```md\r\n[字面](目标.md)\r\n```\r\n';
    await writeFile(source, original);
    const baseline = await edit(source, '当前正文');
    await store.moveFile(source, destination);
    await restartWithLegacyIndex();
    await store.restoreHistory(baseline.id);
    expect(await readFile(destination, 'utf8')).toBe(original);
  });

  it('rebases a moved note without images when the snapshot records its actual source path', async () => {
    const oldDirectory = path.join(notes, '旧位置');
    const newDirectory = path.join(notes, '新位置');
    await mkdir(oldDirectory);
    await mkdir(newDirectory);
    const source = path.join(oldDirectory, 'A.md');
    const destination = path.join(newDirectory, 'A.md');
    const target = path.join(oldDirectory, '目标.md');
    await writeFile(target, '原目标');
    await writeFile(path.join(newDirectory, '目标.md'), '另一份同名目标');
    await writeFile(source, '[目标](目标.md)\n');
    const baseline = await edit(source, '当前正文');
    await store.moveFile(source, destination);
    const restored = await store.restoreHistory(baseline.id);
    const link = extractLinks(restored.content).find((link) => !link.image)!;
    expect((await store.openLinkedFile(destination, link.target))?.path).toBe(target);
  });
});
