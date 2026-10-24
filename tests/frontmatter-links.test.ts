import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractHeadings,
  extractLinks,
  extractTags,
  setFrontmatterTags,
} from '../src/shared/markdown';
import { inspectFrontmatter, withoutFrontmatter } from '../src/editor/frontmatter';
import { linkTargetRanges } from '../electron/storage/markdown-ranges';
import { NoteStore } from '../electron/storage/store';

const stores: NoteStore[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-frontmatter-'));
  directories.push(directory);
  const root = path.join(directory, 'notes');
  await mkdir(root);
  const trash = vi.fn(async (_file: string) => {});
  const store = new NoteStore(path.join(directory, 'profile'), { trash });
  stores.push(store);
  await store.initialize();
  await store.approveDirectory(root);
  await store.saveSettings({ ...store.getSettings(), roots: [root] });
  return { root, store, trash };
}

describe('one frontmatter boundary across reading and file operations', () => {
  it.each(['---\n---\n', '---\n\n---\n'])(
    'recognizes an empty property block without adding a duplicate: %j',
    (prefix) => {
      const source = prefix + '# 正文';
      expect(inspectFrontmatter(source)?.error).toBeNull();
      expect(withoutFrontmatter(source)).toBe('# 正文');
      const changed = setFrontmatterTags(source, ['新']);
      expect(changed).toBe('---\ntags:\n  - 新\n---\n# 正文');
    },
  );
  it('keeps headings, tags and links between ordinary horizontal rules', () => {
    const source =
      '---\n\n# 前言\n\n正文 #学习\n\n![图](assets/keep.png) [链接](before.md)\n\n---\n\n# 后文';
    expect(inspectFrontmatter(source)).toBeNull();
    expect(extractHeadings(source).map((heading) => heading.text)).toEqual(['前言', '后文']);
    expect(extractTags(source)).toEqual(['学习']);
    expect(extractLinks(source).map((link) => link.target)).toEqual([
      'assets/keep.png',
      'before.md',
    ]);
  });
  it('prepends attributes without swallowing ordinary horizontal-rule prose', () => {
    const source = '---\r\n\r\n# 前言\r\n\r\n普通正文\r\n\r\n---\r\n';
    const changed = setFrontmatterTags(source, ['新标签']);
    expect(changed.endsWith(source)).toBe(true);
    expect(extractTags(changed)).toEqual(['新标签']);
    expect(extractHeadings(changed)[0].text).toBe('前言');
  });
  it('retains real link source ranges between ordinary rules while masking code and metadata', () => {
    const prose = '---\n![图](assets/keep.png) [链接](before.md)\n---\n\n`[字面](code.md)`';
    expect(linkTargetRanges(prose).map((range) => range.target)).toEqual([
      'assets/keep.png',
      'before.md',
    ]);
    const attributes = '---\ntags: [学习]\nurl: "[字面](meta.md)"\n---\n\n[正文](body.md)';
    expect(linkTargetRanges(attributes).map((range) => range.target)).toEqual(['body.md']);
    expect(extractLinks(attributes).map((link) => link.target)).toEqual(['body.md']);
  });
  it('protects the displayed image from both cleanup scan and trash', async () => {
    const { root, store, trash } = await fixture();
    const image = path.join(root, 'assets', 'keep.png');
    await mkdir(path.dirname(image));
    await writeFile(image, 'generated image bytes');
    await writeFile(
      path.join(root, 'visible.md'),
      '---\n![正在使用](assets/keep.png)\n---\n\n正文',
    );
    expect((await store.scanAttachments()).map((candidate) => candidate.path)).not.toContain(image);
    await expect(store.trashAttachments([image])).rejects.toThrow(/引用|范围/);
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(image, 'utf8')).toBe('generated image bytes');
  });
  it('repairs links in ordinary rule content on move without touching code examples', async () => {
    const { root, store } = await fixture();
    const source = path.join(root, 'before.md');
    const incoming = path.join(root, 'incoming.md');
    await writeFile(source, '# 目标');
    await writeFile(incoming, '---\n[可点](before.md)\n---\n\n`[字面](before.md)`');
    const outcome = await store.moveFile(source, path.join(root, 'after.md'));
    expect(outcome).not.toBeNull();
    expect(await readFile(incoming, 'utf8')).toBe(
      '---\n[可点](after.md)\n---\n\n`[字面](before.md)`',
    );
  });
  it('keeps valid mapping metadata hidden and refuses to rewrite invalid mapping text', () => {
    const valid = '---\ntags: [学习]\n---\n# 正文';
    expect(inspectFrontmatter(valid)?.error).toBeNull();
    expect(extractTags(valid)).toEqual(['学习']);
    expect(extractHeadings(valid)[0].line).toBe(4);
    const invalid = '---\ntags: [未关闭\n---\n# 正文';
    expect(inspectFrontmatter(invalid)?.error).toBeTruthy();
    expect(() => setFrontmatterTags(invalid, ['新'])).toThrow(/属性/);
  });
});
