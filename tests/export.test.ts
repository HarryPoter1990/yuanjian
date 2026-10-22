import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { NoteStore } from '../electron/storage/store';
import { ExportManager } from '../electron/resources/export';

describe('standalone document and Markdown exports', () => {
  let sandbox: string;
  let root: string;
  let build: string;
  let store: NoteStore;
  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'qingjian-export-'));
    root = path.join(sandbox, '中文资料');
    build = path.join(sandbox, 'build');
    await mkdir(root);
    await mkdir(path.join(build, 'assets'), { recursive: true });
    await writeFile(
      path.join(build, 'assets', 'app.css'),
      `@font-face{font-family:'KaTeX_Main';src:url('./math.woff2') format('woff2')}\n@font-face{font-family:'Noto Sans SC Variable';src:url('./needed.woff2');unicode-range:U+4E2D}\n@font-face{font-family:'Noto Sans SC Variable';src:url('./unused-missing.woff2');unicode-range:U+4E00}\n@font-face{font-family:'Unused Family';src:url('./unused-family-missing.woff2')}\n.katex{font-family:KaTeX_Main}.hljs{color:#123}body{background:black}`,
    );
    await writeFile(path.join(build, 'assets', 'math.woff2'), new Uint8Array([1, 2, 3]));
    await writeFile(path.join(build, 'assets', 'needed.woff2'), new Uint8Array([4, 5, 6]));
    const fixtureCss = await readFile(path.join(build, 'assets', 'app.css'), 'utf8');
    await writeFile(
      path.join(build, 'assets', 'app.css'),
      `${fixtureCss}\n@font-face{font-family:'JetBrains Mono';src:url('./code.woff2') format('woff2')}`,
    );
    await writeFile(path.join(build, 'assets', 'code.woff2'), new Uint8Array([10, 11, 12]));
    store = new NoteStore(path.join(sandbox, 'data'));
    await store.initialize();
    await store.approveDirectory(root);
    await store.saveSettings({ ...store.getSettings(), roots: [root] });
  });
  afterEach(async () => {
    await store.dispose();
    await rm(sandbox, { recursive: true, force: true });
  });
  const html =
    '<!doctype html><html><head><style>body{background:white}</style></head><body><article class="markdown-rendered">中<span class="katex">x</span><img src="note-asset://local/picture"><svg><text>安全图表</text></svg></article></body></html>';

  it('inlines local images and only required font subsets, while retaining user export overrides and SVG', async () => {
    const target = path.join(root, '导出.html');
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      renderPdf: async () => {
        throw new Error('not PDF');
      },
      assetData: async () => ({ bytes: new Uint8Array([7, 8, 9]), mime: 'image/png' }),
    });
    expect(
      await exporter.exportDocument({ format: 'html', html, notePath: null, title: '中文导出' }),
    ).toBe(target);
    const exported = await readFile(target, 'utf8');
    expect(exported).toContain('data:image/png;base64,BwgJ');
    expect(exported).toContain('data:font/woff2;base64,AQID');
    expect(exported).toContain('data:font/woff2;base64,BAUG');
    expect(exported).not.toContain('unused-missing');
    expect(exported).not.toContain('Unused Family');
    expect(exported.indexOf('body{background:white}')).toBeGreaterThan(
      exported.indexOf('body{background:black}'),
    );
    expect(exported).toContain('<svg><text>安全图表</text></svg>');
    expect(exported).not.toContain('note-asset:');
    expect(await readdir(path.join(sandbox, 'data', 'exports'))).toEqual([]);
  });
  it('exports colliding Chinese attachment names into ZIP and rewrites only the exported Markdown', async () => {
    await mkdir(path.join(root, '甲'));
    await mkdir(path.join(root, '乙'));
    await writeFile(path.join(root, '甲', '图.png'), new Uint8Array([1, 2]));
    await writeFile(path.join(root, '乙', '图.png'), new Uint8Array([3, 4]));
    const file = path.join(root, '学习笔记.md');
    const content =
      '![甲](甲/图.png)\n\n![乙](乙/图.png)\n\n![网络](https://example.invalid/a.png)\n\n`![示例](甲/图.png)`\n';
    await writeFile(file, content);
    const target = path.join(root, '打包.zip');
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      renderPdf: async () => undefined,
      assetData: async () => {
        throw new Error('unused');
      },
    });
    expect(await exporter.exportBundle(file, content)).toBe(target);
    const archive = unzipSync(await readFile(target));
    const names = Object.keys(archive);
    expect(names).toContain('学习笔记.md');
    const markdown = strFromU8(archive['学习笔记.md']);
    const local = [...markdown.matchAll(/!\[[甲乙]\]\(([^)]+)\)/g)].map((match) =>
      decodeURIComponent(match[1]),
    );
    expect(new Set(local).size).toBe(2);
    expect(archive[local[0]]).toEqual(new Uint8Array([1, 2]));
    expect(archive[local[1]]).toEqual(new Uint8Array([3, 4]));
    expect(markdown).toContain('`![示例](甲/图.png)`');
    expect(markdown).toContain('https://example.invalid/a.png');
    expect(await readFile(file, 'utf8')).toBe(content);
  });
  it('rewrites ZIP image usages without retargeting ordinary links or a shared image/link definition', async () => {
    await mkdir(path.join(root, '原始图片'));
    await writeFile(path.join(root, '原始图片', '图.png'), new Uint8Array([1, 2, 3]));
    const targetImage = '原始图片/图.png';
    const definition = `[shared]: ${targetImage} "图片标题"`;
    const content = `![图片](${targetImage})\n[普通链接](${targetImage})\n\n![引用图片][shared]\n[普通引用][shared]\n\n${definition}\n\n\`![示例](${targetImage})\``;
    const file = path.join(root, '共享引用.md');
    await writeFile(file, content);
    const output = path.join(root, '共享引用.zip');
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => output,
      renderPdf: async () => undefined,
      assetData: async () => {
        throw new Error('unused');
      },
    });
    await exporter.exportBundle(file, content);
    const archive = unzipSync(await readFile(output));
    const result = strFromU8(archive['共享引用.md']);
    expect(result).toContain(`[普通链接](${targetImage})`);
    expect(result).toContain('[普通引用][shared]');
    expect(result).toContain(definition);
    expect(result).toContain(`\`![示例](${targetImage})\``);
    expect(result).toMatch(/!\[图片\]\(assets\//);
    expect(result).toMatch(/!\[引用图片\]\(assets\/[^)]+ "图片标题"\)/);
    expect(await readFile(file, 'utf8')).toBe(content);
  });
  it('refuses missing referenced images and does not create a deceptively incomplete ZIP', async () => {
    const file = path.join(root, '缺图.md');
    const content = '![缺图](不存在.png)';
    await writeFile(file, content);
    const target = path.join(root, 'bad.zip');
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      renderPdf: async () => undefined,
      assetData: async () => {
        throw new Error('unused');
      },
    });
    await expect(exporter.exportBundle(file, content)).rejects.toThrow(/图片|附件/);
    await expect(readFile(target)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(content);
  });
  it('refuses CSS resource traversal instead of copying outside files', async () => {
    await writeFile(path.join(sandbox, 'outside.woff2'), 'secret');
    await writeFile(
      path.join(build, 'assets', 'app.css'),
      '@font-face{font-family:KaTeX_Main;src:url(../../outside.woff2)}.katex{color:red}',
    );
    const target = path.join(root, 'bad.html');
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      renderPdf: async () => undefined,
      assetData: async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' }),
    });
    await expect(
      exporter.exportDocument({ format: 'html', html, notePath: null, title: '越界' }),
    ).rejects.toThrow(/越|目录|范围/);
    await expect(readFile(target)).rejects.toThrow();
  });
  it('returns null on cancel, and cleans PDF temporary input after renderer failure', async () => {
    const cancelled = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => null,
      renderPdf: async () => undefined,
      assetData: async () => {
        throw new Error('must not fetch');
      },
    });
    expect(
      await cancelled.exportDocument({ format: 'html', html, notePath: null, title: '取消' }),
    ).toBeNull();
    const target = path.join(root, '失败.pdf');
    const failed = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      assetData: async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' }),
      renderPdf: async (input) => {
        expect(await readFile(input, 'utf8')).toContain('data:image/png');
        throw new Error('PDF renderer failed');
      },
    });
    await expect(
      failed.exportDocument({ format: 'pdf', html, notePath: null, title: '失败' }),
    ).rejects.toThrow('PDF renderer failed');
    expect(await readdir(path.join(sandbox, 'data', 'exports'))).toEqual([]);
    await expect(readFile(target)).rejects.toThrow();
  });
  it('copies a completed PDF atomically and preserves an existing export on rendering failure', async () => {
    const target = path.join(root, '打印.pdf');
    const completed = Buffer.from('%PDF-1.7\nfixture\n%%EOF');
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      assetData: async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' }),
      renderPdf: async (input, temporaryOutput) => {
        expect(path.dirname(input)).toBe(path.dirname(temporaryOutput));
        expect(temporaryOutput).not.toBe(target);
        await writeFile(temporaryOutput, completed);
      },
    });
    expect(
      await exporter.exportDocument({ format: 'pdf', html, notePath: null, title: '打印' }),
    ).toBe(target);
    expect(await readFile(target)).toEqual(completed);
    const failed = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      assetData: async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' }),
      renderPdf: async (_input, temporaryOutput) => {
        await writeFile(temporaryOutput, 'partial');
        throw new Error('interrupted');
      },
    });
    await expect(
      failed.exportDocument({ format: 'pdf', html, notePath: null, title: '打印' }),
    ).rejects.toThrow('interrupted');
    expect(await readFile(target)).toEqual(completed);
    expect(await readdir(path.join(sandbox, 'data', 'exports'))).toEqual([]);
  });
  it('reports missing required font bytes and missing build CSS explicitly', async () => {
    const target = path.join(root, '缺字体.html');
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      assetData: async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' }),
      renderPdf: async () => undefined,
    });
    await rm(path.join(build, 'assets', 'math.woff2'));
    await expect(
      exporter.exportDocument({ format: 'html', html, notePath: null, title: '缺字体' }),
    ).rejects.toThrow(/字体.*缺失/);
    await expect(readFile(target)).rejects.toThrow();
    await rm(path.join(build, 'assets', 'app.css'));
    await expect(
      exporter.exportDocument({ format: 'html', html, notePath: null, title: '缺样式' }),
    ).rejects.toThrow(/样式不存在/);
  });
  it('embeds selected managed fonts without copying unselected managed or system fonts', async () => {
    const target = path.join(root, '自选字体.html');
    const fonts = path.join(sandbox, 'data', 'fonts');
    await mkdir(fonts);
    const selected = path.join(fonts, 'selected.ttf');
    await writeFile(selected, new Uint8Array([9, 8, 7, 6]));
    await store.saveSettings({
      ...store.getSettings(),
      appearance: {
        ...store.getSettings().appearance,
        bodyFont: 'Imported Font',
        headingFont: 'Imported Font',
      },
    });
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      assetData: async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' }),
      renderPdf: async () => undefined,
      managedFonts: async () => [
        { id: 'selected', name: 'Imported Font', source: 'imported', path: selected },
        {
          id: 'unused',
          name: 'Unused Imported',
          source: 'imported',
          path: path.join(fonts, 'missing.ttf'),
        },
      ],
    });
    await exporter.exportDocument({ format: 'html', html, notePath: null, title: '字体' });
    const result = await readFile(target, 'utf8');
    expect(result).toContain('data:font/ttf;base64,CQgHBg==');
    expect(result).not.toContain('Unused Imported');
  });
  it('inlines wallpaper asset URLs in the preserved export style block', async () => {
    const target = path.join(root, '壁纸.html');
    const styled = html.replace(
      'body{background:white}',
      'body{background-image:url("note-asset://local/wallpaper")}',
    );
    const exporter = new ExportManager(store, {
      buildDirectory: build,
      chooseSave: async () => target,
      assetData: async () => ({ bytes: new Uint8Array([7, 8, 9]), mime: 'image/png' }),
      renderPdf: async () => undefined,
    });
    await exporter.exportDocument({ format: 'html', html: styled, notePath: null, title: '壁纸' });
    expect(await readFile(target, 'utf8')).not.toContain('note-asset:');
    expect(await readFile(target, 'utf8')).toContain(
      'background-image:url("data:image/png;base64,BwgJ")',
    );
  });
});
