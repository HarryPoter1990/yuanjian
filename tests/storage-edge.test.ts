import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

describe('storage edge cases', () => {
  let sandbox: string;
  let root: string;
  let store: NoteStore;
  let now: number;
  beforeEach(async () => {
    now = 1800000000000;
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-edge-'));
    root = path.join(sandbox, '笔记');
    await mkdir(root);
    store = new NoteStore(path.join(sandbox, 'data'), {
      now: () => now,
      trash: async (file) => rm(file),
    });
    await store.initialize();
    await store.approveDirectory(root);
    await store.saveSettings({ ...store.getSettings(), roots: [root] });
  });
  afterEach(async () => {
    await store.dispose();
    await rm(sandbox, { recursive: true, force: true });
  });
  it('does not overwrite an existing note when a new draft supplies a path without a base hash', async () => {
    const file = path.join(root, '已存在.md');
    await writeFile(file, '真实原文');
    const result = await store.saveFile({
      path: file,
      content: '新草稿',
      baseContent: '',
      hash: '',
      title: '新草稿',
    });
    expect(result.status).toBe('conflict');
    expect(await readFile(file, 'utf8')).toBe('真实原文');
  });
  it('rejects unapproved wallpaper paths hidden in inactive saved themes', async () => {
    const privateImage = path.join(sandbox, 'private.png');
    await writeFile(privateImage, 'private');
    const settings = store.getSettings();
    await expect(
      store.saveSettings({
        ...settings,
        themes: [
          ...settings.themes,
          {
            id: 'injected',
            name: '隐藏主题',
            appearance: { ...settings.appearance, wallpaper: privateImage },
          },
        ],
      }),
    ).rejects.toThrow(/授权/);
    const restarted = new NoteStore(path.join(sandbox, 'data'));
    await restarted.initialize();
    await expect(restarted.authorize(privateImage)).rejects.toThrow(/授权/);
    await restarted.dispose();
  });
  it('keeps mixed newline bytes untouched when saving unchanged Markdown', async () => {
    const file = path.join(root, '混合换行.md');
    const original = '\ufeff# 标题\r\n\n段落\r\n末行\n';
    await writeFile(file, original);
    const note = (await store.openFile(file))!;
    await store.saveFile({
      path: file,
      content: note.content,
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(await store.listHistory(file)).toEqual([]);
    await store.saveFile({
      path: file,
      content: note.content.replace(/\r\n/g, '\n').replace('段落', '新的段落'),
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    expect(await readFile(file, 'utf8')).toBe(original.replace('段落', '新的段落'));
  });
  it('does not rewrite apparent Markdown links inside fenced or inline code during moves', async () => {
    const file = path.join(root, '原始.md');
    await writeFile(file, '内容');
    const linked = path.join(root, '引用.md');
    const code = '`[原始](原始.md)`\n\n```md\n[原始](原始.md)\n[[原始]]\n```';
    await writeFile(linked, `[原始](原始.md)\n\n${code}`);
    await store.moveFile(file, path.join(root, '新名.md'));
    expect(await readFile(linked, 'utf8')).toBe(`[原始](新名.md)\n\n${code}`);
  });
  it('does not count a wikilinked image as an unused attachment', async () => {
    await mkdir(path.join(root, 'assets'));
    const image = path.join(root, 'assets', '图.png');
    await writeFile(image, 'image');
    await writeFile(path.join(root, '引用.md'), '![[图.png]]');
    expect(await store.scanAttachments()).toEqual([]);
  });
  it('repairs reference definitions and balanced-parenthesis links without reformatting text', async () => {
    const file = path.join(root, '原(始).md');
    await writeFile(file, '内容');
    const linked = path.join(root, '引用.md');
    await writeFile(linked, '[直接](原(始).md)\n\n[引用][id]\n\n[id]: 原(始).md "原有标题"\n');
    await store.moveFile(file, path.join(root, '新.md'));
    expect(await readFile(linked, 'utf8')).toBe(
      '[直接](新.md)\n\n[引用][id]\n\n[id]: 新.md "原有标题"\n',
    );
  });
  it('backs up short-name wiki images and restores standalone-note images after links were removed', async () => {
    const standalone = path.join(sandbox, 'standalone');
    await mkdir(standalone);
    await mkdir(path.join(standalone, 'assets'));
    const file = path.join(standalone, '独立.md');
    const image = path.join(standalone, 'assets', '图.png');
    await writeFile(image, new Uint8Array([1, 2, 3]));
    await writeFile(file, '![图](assets/图.png)\n');
    await store.approveFile(file);
    const note = (await store.openFile(file))!;
    await store.saveFile({
      path: file,
      content: '不再引用图片',
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    const baseline = (await store.listHistory(file)).find(
      (entry) => entry.reason === '修改前基线',
    )!;
    await rm(image);
    await store.restoreHistory(baseline.id);
    expect(await readFile(image)).toEqual(Buffer.from([1, 2, 3]));
    const wikiFile = path.join(root, 'wiki.md');
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', '图.png'), new Uint8Array([4, 5, 6]));
    await writeFile(wikiFile, '![[图.png]]');
    const wiki = (await store.openFile(wikiFile))!;
    await store.saveFile({
      path: wikiFile,
      content: `${wiki.content}\n编辑`,
      baseContent: wiki.content,
      hash: wiki.hash,
      title: wiki.title,
    });
    expect((await store.listHistory(wikiFile)).every((entry) => entry.imageBytes === 3)).toBe(true);
  });
  it('restores validated settings and unsaved drafts across store instances', async () => {
    await store.saveSession({
      tabs: [
        {
          id: 'draft',
          path: null,
          title: '草稿',
          content: '未保存的中文',
          hash: '',
          modifiedAt: now,
          baseContent: '',
          dirty: true,
          cursor: 3,
          scrollTop: 9,
          mode: 'live',
        },
      ],
      activeId: 'draft',
    });
    await store.saveSettings({
      ...store.getSettings(),
      appearance: { ...store.getSettings().appearance, fontSize: 21 },
    });
    const restarted = new NoteStore(path.join(sandbox, 'data'));
    await restarted.initialize();
    expect(restarted.getSettings().appearance.fontSize).toBe(21);
    expect(restarted.getSession().tabs[0].content).toBe('未保存的中文');
    expect(restarted.getSession().tabs[0].cursor).toBe(3);
    await restarted.dispose();
  });
  it('ages externally deleted pinned history from deletion discovery instead of keeping it forever', async () => {
    const file = path.join(root, '删除.md');
    await writeFile(file, 'before');
    const note = (await store.openFile(file))!;
    await store.saveFile({
      path: file,
      content: 'after',
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    for (const entry of await store.listHistory(file)) await store.pinHistory(entry.id, true);
    now += 60 * 86400_000;
    await rm(file);
    await store.pruneHistory();
    expect((await store.listHistory(file)).length).toBeGreaterThan(0);
    now += 31 * 86400_000;
    await store.pruneHistory();
    expect(await store.listHistory(file)).toEqual([]);
  });
  it('refuses directory junction escapes and omits them from the index', async () => {
    const outside = path.join(sandbox, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'private.md'), 'secret');
    await symlink(outside, path.join(root, 'junction'), 'junction');
    await expect(store.openFile(path.join(root, 'junction', 'private.md'))).rejects.toThrow(/授权/);
    expect(await store.getIndex()).toEqual([]);
  });
  it('localizes only real image tokens and reports unsupported/network failures without deleting URLs', async () => {
    const file = path.join(root, '网络.md');
    const url = 'https://example.invalid/a.png';
    const content = `![远程](${url})\n\n普通网址：${url}\n\n\`![示例](${url})\``;
    await writeFile(file, content);
    const networkStore = new NoteStore(path.join(sandbox, 'network-data'), {
      fetch: async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    });
    await networkStore.initialize();
    await networkStore.approveDirectory(root);
    const localized = await networkStore.localizeImages(file, content);
    expect(localized.results[0].error).toBeUndefined();
    expect(localized.content).toContain(`普通网址：${url}`);
    expect(localized.content).toContain(`\`![示例](${url})\``);
    expect(localized.content).toMatch(/^!\[远程\]\(assets\//);
    await networkStore.dispose();
    const failingStore = new NoteStore(path.join(sandbox, 'failing-data'), {
      fetch: async () => {
        throw new Error('offline');
      },
    });
    await failingStore.initialize();
    await failingStore.approveDirectory(root);
    const failed = await failingStore.localizeImages(file, content);
    expect(failed.content).toBe(content);
    expect(failed.results[0].error).toContain('offline');
    await failingStore.dispose();
  });
  it('creates a templated daily note once and prevents path traversal in date patterns', async () => {
    await store.saveSettings({ ...store.getSettings(), journalDirectory: root });
    const note = (await store.periodicNote('daily', '2026-10-22'))!;
    expect(note.content).toContain('2026-10-22');
    await writeFile(note.path!, '我的日记');
    expect((await store.periodicNote('daily', '2026-10-22'))?.content).toBe('我的日记');
    await store.saveSettings({ ...store.getSettings(), dailyPattern: '../../escape.md' });
    await expect(store.periodicNote('daily', '2026-10-23')).rejects.toThrow(/目录/);
  });
  it('preserves literal backslash-n inside user template code blocks', async () => {
    const template = '# {{date}}\n\n```js\nconst newline = "\\n";\n```\n';
    await store.saveSettings({
      ...store.getSettings(),
      journalDirectory: root,
      templates: [{ id: 'literal', name: '代码日记', kind: 'daily', content: template }],
    });
    const note = (await store.periodicNote('daily', '2026-10-23', 'literal'))!;
    expect(note.content).toBe(template.replace('{{date}}', '2026-10-23'));
  });
});
