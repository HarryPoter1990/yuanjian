import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSettings } from '../src/shared/defaults';
import { unzipSync, strFromU8 } from 'fflate';

// Windows command-line parsing treats a quoted directory's trailing backslash as an escaped quote.
const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
let application: ElectronApplication;
let page: Page;
let fixture: string;
let profile: string;
const errors: string[] = [];
const sample =
  '---\ntags: [学习]\n---\n# 中文学习笔记\n\n这是可移植的本地笔记。 #代码\n\n## 数学公式\n\n行内公式 $E=mc^2$，以及：\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\n## 程序示例\n\n```java\npublic class Hello {\n    public static void main(String[] args) {\n        System.out.println("中文你好");\n    }\n}\n```\n\n## 表格\n\n| 主题 | 状态 |\n| --- | --- |\n| Markdown | 已记录 |\n\n## 本地图片\n\n![测试图片](assets/示意图.svg)\n\n## 流程图\n\n```mermaid\nflowchart LR\n A[打开笔记] --> B[自由书写] --> C[保存到本地]\n```\n\n## 相关内容\n\n[[另一篇#目标]]\n';

async function launch(initialFile?: string) {
  const env: Record<string, string> = { LOCAL_NOTES_TEST: '1' };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.LOCAL_NOTES_TEST = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  application = await _electron.launch({
    executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: [project, `--data-dir=${profile}`, ...(initialFile ? [initialFile] : [])],
    env,
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeVisible({
    timeout: 30000,
  });
}
async function selectOpen(file: string) {
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, file);
  await page.getByRole('button', { name: '打开 Markdown 文件', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: path.basename(file, '.md'), exact: true }),
  ).toBeVisible();
}
async function menu(item: string) {
  await page.getByRole('button', { name: '笔记操作菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
async function chooseOutput(file: string) {
  await application.evaluate(({ dialog }, selected) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected });
  }, file);
}
test.beforeEach(async () => {
  errors.length = 0;
  await mkdir(path.join(project, '.test-data'), { recursive: true });
  fixture = await mkdtemp(path.join(project, '.test-data', '完整验收-'));
  profile = path.join(fixture, 'profile');
  await mkdir(profile);
  await mkdir(path.join(fixture, '笔记', 'assets'), { recursive: true });
  await writeFile(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      ...defaultSettings,
      roots: [path.join(fixture, '笔记')],
      journalDirectory: path.join(fixture, '笔记'),
    }),
  );
  await writeFile(path.join(fixture, '笔记', '中文学习.md'), sample);
  await writeFile(
    path.join(fixture, '笔记', '另一篇.md'),
    '# 另一篇\n\n## 目标\n\n[回到学习](中文学习.md)\n',
  );
  await writeFile(
    path.join(fixture, '笔记', 'assets', '示意图.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="100"><rect width="420" height="100" rx="12" fill="#e0ede7"/><circle cx="50" cy="50" r="24" fill="#3b756b"/><path d="M100 35h270M100 55h180M100 75h220" stroke="#3b756b" stroke-width="6"/></svg>',
  );
  await launch();
});
test.afterEach(async () => {
  await application?.close();
});

test('real window opens arbitrary Chinese files, saves source and restores a session', async () => {
  const file = path.join(fixture, '笔记', '中文学习.md');
  await selectOpen(file);
  await expect(page.getByRole('button', { name: '数学公式', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '即时排版', exact: true }).click();
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('追加中文验收。');
  await page.keyboard.press('Enter');
  await expect.poll(() => readFile(file, 'utf8')).toBe(sample + '追加中文验收。\n');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect.poll(() => readFile(file, 'utf8')).toBe(sample + '追加中文验收。\n');
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '跨文件搜索', exact: true }).fill('追加中文验收');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await page.screenshot({ path: path.join(project, '.test-data', 'desktop-window.png') });
  const fonts = await page.evaluate(() => window.notes.getFonts());
  expect(fonts.some((font) => font.source === 'system')).toBe(true);
  expect(fonts.filter((font) => font.source === 'bundled')).toHaveLength(4);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(project, '.test-data', 'desktop-settings.png') });
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  const exited = application.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
  await launch();
  await expect(page.getByRole('tab', { name: '中文学习', exact: true })).toBeVisible();
  expect(await readFile(file, 'utf8')).toBe(sample + '追加中文验收。\n');
  expect(errors).toEqual([]);
});

test('real watcher refreshes external edits and conflict resolution preserves both versions', async () => {
  const file = path.join(fixture, '笔记', '中文学习.md');
  await selectOpen(file);
  await writeFile(file, sample.replace('这是可移植', '外部更新：这是可移植'));
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.notes.bootstrap()).session.tabs.find((tab) =>
            tab.path?.endsWith('中文学习.md'),
          )?.content,
      ),
    )
    .toContain('外部更新');
  // Disable autosave to create a genuine concurrent edit, without replacing the store or editor.
  await page.evaluate(async () => {
    const boot = await window.notes.bootstrap();
    await window.notes.saveSettings({ ...boot.settings, autoSave: false });
  });
  await page.reload();
  await expect(page.getByRole('tab', { name: '中文学习', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '即时排版', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.insertText('本地插入\n');
  await writeFile(file, `外部插入\n${sample}`);
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('dialog', { name: '文件发生外部修改 · 保留你的内容' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '冲突本地版本' })).toHaveValue(/本地插入/);
  await expect(page.getByRole('textbox', { name: '冲突外部版本' })).toHaveValue(/外部插入/);
  await page.getByRole('button', { name: '保留双方，稍后整理', exact: true }).click();
  await expect(page.getByRole('tab', { name: /^中文学习 · 本地保留/ })).toBeVisible();
  expect(await readFile(file, 'utf8')).toBe(`外部插入\n${sample}`);
  expect(errors).toEqual([]);
});

test('real exports contain rendered formula, diagrams, local images and a portable ZIP', async () => {
  await selectOpen(path.join(fixture, '笔记', '中文学习.md'));
  await menu('阅读预览');
  await expect(page.locator('.reading-preview .katex').first()).toBeVisible();
  await expect(page.locator('.reading-preview .mermaid-diagram svg')).toBeVisible({
    timeout: 30000,
  });
  expect(
    await page
      .locator('.reading-preview img')
      .evaluateAll((images) =>
        images.every(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  await page.screenshot({ path: path.join(project, '.test-data', 'desktop-preview.png') });
  const htmlFile = path.join(fixture, '验收.html');
  await chooseOutput(htmlFile);
  await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
  await expect
    .poll(async () =>
      (await readFile(htmlFile, 'utf8').catch(() => '')).includes('data:image/svg+xml;base64,'),
    )
    .toBe(true);
  const exported = await readFile(htmlFile, 'utf8');
  expect(exported).toContain('data:font/woff2;base64,');
  expect(exported).not.toContain('note-asset:');
  const pdfFile = path.join(fixture, '验收.pdf');
  await chooseOutput(pdfFile);
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  await expect
    .poll(
      async () => (await readFile(pdfFile).catch(() => Buffer.alloc(0))).subarray(0, 5).toString(),
      { timeout: 45000 },
    )
    .toBe('%PDF-');
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  const zipFile = path.join(fixture, '验收.zip');
  await chooseOutput(zipFile);
  await menu('导出 Markdown 与附件 ZIP');
  await expect
    .poll(async () => (await readFile(zipFile).catch(() => Buffer.alloc(0))).length)
    .toBeGreaterThan(100);
  const archive = unzipSync(await readFile(zipFile));
  expect(strFromU8(archive['中文学习.md'])).toContain('assets/%E7%A4%BA%E6%84%8F%E5%9B%BE.svg');
  expect(archive['assets/示意图.svg']).toBeDefined();
  await copyFile(pdfFile, path.join(project, '.test-data', 'export-verification.pdf'));
  await copyFile(htmlFile, path.join(project, '.test-data', 'export-verification.html'));
  expect(errors).toEqual([]);
});

test('fonts and wallpaper stay app-local, diary and graph persist through restart', async () => {
  await selectOpen(path.join(fixture, '笔记', '中文学习.md'));
  const fontFile = path.join(fixture, '我的代码字体.woff2');
  await copyFile(
    path.join(
      project,
      'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
    ),
    fontFile,
  );
  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fontFile);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '字体管理', exact: true }).click();
  await page.getByRole('button', { name: '导入字体 / ZIP', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索字体' }).fill('我的代码字体');
  await expect(page.locator('.font-row')).toHaveCount(1);
  await expect(page.locator('.font-row')).toContainText('已导入');
  await page.getByRole('combobox', { name: '代码字体' }).selectOption('我的代码字体');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(document.fonts).some(
          (font) =>
            font.family.replace(/^"|"$/g, '') === '我的代码字体' && font.status === 'loaded',
        ),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '外观与主题', exact: true }).click();
  const wallpaper = path.join(fixture, '壁纸.png');
  await writeFile(
    wallpaper,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, wallpaper);
  await page.getByRole('button', { name: '选择图片', exact: true }).click();
  await page.getByRole('combobox', { name: '明暗模式' }).selectOption('dark');
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(page.locator('.wallpaper')).toHaveCSS('background-image', /note-asset:/);
  await page.getByRole('button', { name: '关系图谱', exact: true }).click();
  await expect(page.locator('.graph-legend')).toContainText('2 个节点');
  await expect(page.locator('.graph-canvas canvas').first()).toBeVisible();
  await expect(page.getByText('正在整理笔记关系…', { exact: true })).toBeHidden({ timeout: 20000 });
  await page.getByRole('button', { name: '放大图谱', exact: true }).click();
  await page.screenshot({ path: path.join(project, '.test-data', 'desktop-graph.png') });
  await page.getByRole('button', { name: '关闭关系图谱', exact: true }).click();
  await expect
    .poll(async () =>
      Object.keys((await page.evaluate(() => window.notes.bootstrap())).settings.graph.positions),
    )
    .toContain(path.join(fixture, '笔记/中文学习.md'));
  await page.getByRole('tab', { name: '日历', exact: true }).click();
  await page.getByRole('button', { name: '打开 / 新建日记', exact: true }).click();
  await expect(page.locator('.document-breadcrumb')).toContainText('.md');
  await expect(page.locator('.note-tags')).toContainText('日记');
  await page.getByRole('button', { name: '按模板另写一篇', exact: true }).click();
  await expect(page.locator('.document-breadcrumb')).toContainText('-2.md');
  await page.getByRole('button', { name: '按模板另写一篇', exact: true }).click();
  await expect(page.locator('.document-breadcrumb')).toContainText('-3.md');
  await expect(page.locator('.note-tags')).toContainText('日记');
  const exited = application.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
  const before = await readFile(path.join(profile, 'fonts', 'manifest.json'), 'utf8');
  await launch();
  expect(await readFile(path.join(profile, 'fonts', 'manifest.json'), 'utf8')).toBe(before);
  const state = await page.evaluate(() => window.notes.bootstrap());
  expect(state.settings.appearance.codeFont).toBe('我的代码字体');
  expect(state.settings.appearance.wallpaper).toBe(wallpaper);
  expect(state.settings.appearance.mode).toBe('dark');
  expect(state.fonts.some((font) => font.name === '我的代码字体')).toBe(true);
  expect(errors).toEqual([]);
});

test('command-line file opening waits for startup and IPC rejects unapproved local paths', async () => {
  const exited = application.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
  await launch(path.join(fixture, '笔记', '中文学习.md'));
  await expect(page.getByRole('tab', { name: '中文学习', exact: true })).toBeVisible();
  const secret = path.join(fixture, '未授权.md');
  await writeFile(secret, '不可读取的测试内容');
  const denied = await page.evaluate(async (file) => {
    try {
      await window.notes.openFile(file);
      return false;
    } catch {
      return true;
    }
  }, secret);
  expect(denied).toBe(true);
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  expect(
    await page.evaluate(async () => {
      try {
        await window.notes.openExternal('javascript:alert(1)');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(errors).toEqual([]);
});
