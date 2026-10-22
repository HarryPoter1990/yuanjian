import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

describe('explicit navigation from a standalone note', () => {
  let sandbox: string;
  let notes: string;
  let source: string;
  let neighbor: string;
  let store: NoteStore;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'qingjian-linked-'));
    notes = path.join(sandbox, '独立中文目录');
    await mkdir(notes);
    source = path.join(notes, '入口.md');
    neighbor = path.join(notes, '中文 邻居.md');
    await writeFile(neighbor, '# 邻居标题\n\n邻居正文');
    await writeFile(
      source,
      '[邻居](中文%20邻居.md#邻居标题)\n\n[[中文 邻居#邻居标题|别名]]\n\n[缺失](缺失.md)\n\n`[代码链接](其他.md)`\n\n```md\n[代码块](其他.md)\n```',
    );
    await writeFile(path.join(notes, '其他.md'), '不能通过伪造链接打开');
    store = new NoteStore(path.join(sandbox, 'data'));
    await store.initialize();
    await store.approveFile(source);
  });

  afterEach(async () => {
    await store.dispose();
    await rm(sandbox, { recursive: true, force: true });
  });

  it('opens an actual relative Markdown link including an encoded Chinese name and anchor', async () => {
    expect((await store.resolveLink(source, '中文%20邻居.md#邻居标题')).exists).toBe(false);
    await expect(store.openFile(neighbor)).rejects.toThrow(/授权/);
    const opened = await store.openLinkedFile(
      source,
      '%E4%B8%AD%E6%96%87%20%E9%82%BB%E5%B1%85.md#%E9%82%BB%E5%B1%85%E6%A0%87%E9%A2%98',
    );
    expect(opened?.path).toBe(neighbor);
    expect(opened?.content).toContain('邻居正文');
    await expect(store.getTree(notes)).rejects.toThrow(/授权/);
    await expect(store.openFile(path.join(notes, '其他.md'))).rejects.toThrow(/授权/);
    expect(store.getApprovedPaths().directories).toEqual([]);
  });

  it('normalizes a real wiki link with its wrapper, alias and heading without approving its folder', async () => {
    const opened = await store.openLinkedFile(source, '[[中文 邻居#邻居标题|别名]]');
    expect(opened?.path).toBe(neighbor);
    await expect(store.getTree(notes)).rejects.toThrow(/授权/);
  });

  it('rejects forged targets and links occurring only in code; missing actual links return null', async () => {
    await expect(store.openLinkedFile(source, '其他.md')).rejects.toThrow(/链接/);
    expect(await store.openLinkedFile(source, '缺失.md')).toBeNull();
    await expect(store.authorize(path.join(notes, '缺失.md'))).rejects.toThrow(/授权/);
    expect(await readFile(path.join(notes, '其他.md'), 'utf8')).toBe('不能通过伪造链接打开');
  });

  it('rejects image-only references, non-Markdown links and an unauthorized source', async () => {
    await writeFile(source, '![图片](图片.md)\n\n[文本](附件.txt)');
    await writeFile(path.join(notes, '图片.md'), 'image-like');
    await writeFile(path.join(notes, '附件.txt'), 'attachment');
    await expect(store.openLinkedFile(source, '图片.md')).rejects.toThrow(/链接/);
    await expect(store.openLinkedFile(source, '附件.txt')).rejects.toThrow(/Markdown/);
    await expect(store.openLinkedFile(path.join(notes, '其他.md'), '中文 邻居.md')).rejects.toThrow(
      /授权/,
    );
  });
});
