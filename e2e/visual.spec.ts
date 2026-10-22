import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EditorView } from '@codemirror/view';
import { defaultSettings } from '../src/shared/defaults';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

test('visual revision preserves source and preferences through resizing, palette and window changes', async () => {
  const fixture = await mkdtemp(path.join(project, '.test-data/视觉验收-'));
  const profile = path.join(fixture, 'profile');
  const notes = path.join(fixture, '笔记');
  await mkdir(profile);
  await mkdir(notes);
  const file = path.join(notes, '循环与累加.md');
  const source =
    '# 从循环到累加：把思路写清楚\n\n把每一次理解记录下来，比记住一个答案更有用。\n\n## 一个简单的累加\n\n```java\nstatic int sum(int n) {\n    int total = 0;\n    for (int i = 1; i <= n; i++) total += i;\n    return total;\n}\n```\n\n循环中的 `total` 保存当前结果。\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\n| 检查项 | 输入 | 预期结果 |\n| --- | --- | --- |\n| 最小情况 | n=1 | 1 |\n| 连续累加 | n=5 | 15 |\n\n## 边界条件的思考\n\n记录每一步的理解。\n';
  await writeFile(file, source);
  await writeFile(
    path.join(profile, 'settings.json'),
    JSON.stringify({ ...defaultSettings, roots: [notes] }),
  );
  const env: Record<string, string> = { LOCAL_NOTES_TEST: '1' };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.LOCAL_NOTES_TEST = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  const out = path.join(project, 'artifacts/visual-final');
  await mkdir(out, { recursive: true });
  const launch = () =>
    _electron.launch({
      executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
      args: [project, `--data-dir=${profile}`, file],
      env,
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.cm-content')).toContainText('从循环到累加', { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page
        .locator('.iris-logo')
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    expect(await page.locator('[data-fluent-icon]').count()).toBeGreaterThan(15);
    expect(await page.locator('.code-caption svg path').count()).toBeGreaterThan(0);
    expect(
      await page
        .locator('.code-caption svg path')
        .evaluateAll((paths) =>
          paths.every((element) => /^M[\d.]/.test(element.getAttribute('d') ?? '')),
        ),
    ).toBe(true);
    await page.screenshot({ path: path.join(out, 'light.png') });

    await page.evaluate(() => {
      const content = document.querySelector('.cm-content') as HTMLElement & {
        cmTile?: { root?: { view: EditorView } };
      };
      const view = content.cmTile?.root?.view;
      if (!view) throw new Error('Cannot inspect mounted editor');
      const probe = window as unknown as { resizeReconfigs: number };
      probe.resizeReconfigs = 0;
      const update = view.update.bind(view);
      view.update = (transactions) => {
        probe.resizeReconfigs += transactions.filter(
          (transaction) => transaction.reconfigured,
        ).length;
        update(transactions);
      };
    });
    const beforeWidth = (await page.evaluate(() => window.notes.bootstrap())).settings.leftWidth;
    const separator = page.getByRole('separator', { name: '调整左侧栏宽度', exact: true });
    const box = await separator.boundingBox();
    if (!box) throw new Error('Missing visible resize separator');
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    for (let i = 1; i <= 56; i++)
      await page.mouse.move(box.x + box.width / 2 + (72 * i) / 56, box.y + 100);
    await page.mouse.up();
    await expect
      .poll(async () => (await page.evaluate(() => window.notes.bootstrap())).settings.leftWidth)
      .toBeGreaterThan(beforeWidth + 50);
    const reconfigurations = await page.evaluate(
      () => (window as unknown as { resizeReconfigs: number }).resizeReconfigs,
    );
    expect(reconfigurations).toBe(0);

    await page.keyboard.press('Control+,');
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: '字体管理', exact: true }).click();
    await settings
      .getByRole('combobox', { name: '正文字体', exact: true })
      .selectOption('Noto Serif SC Variable');
    await settings.getByRole('button', { name: '外观与主题', exact: true }).click();
    await settings.getByRole('button', { name: '暖铜与纸色', exact: true }).click();
    await settings.getByRole('combobox', { name: '明暗模式', exact: true }).selectOption('dark');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.notes.bootstrap())).settings.appearance.bodyFont,
      )
      .toBe('Noto Serif SC Variable');
    await page.screenshot({ path: path.join(out, 'settings-dark.png') });
    await page.keyboard.press('Escape');
    await expect(settings).not.toBeVisible();
    await page.screenshot({ path: path.join(out, 'dark-paper.png') });
    expect(await readFile(file, 'utf8')).toBe(source);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      win.setSize(800, 720);
    });
    await expect(
      page.getByRole('separator', { name: '调整右侧栏宽度', exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('separator', { name: '调整左侧栏宽度', exact: true }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(600, 720));
    await expect(separator).not.toBeVisible();
    await page.screenshot({ path: path.join(out, 'narrow.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await page.evaluate(() => window.notes.bootstrap())).settings).toMatchObject({
      leftVisible: true,
      rightVisible: true,
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
    await expect(separator).toBeVisible();
    await expect(
      page.getByRole('separator', { name: '调整右侧栏宽度', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Control+,');
    await settings.getByRole('button', { name: '字体管理', exact: true }).click();
    await settings
      .getByRole('combobox', { name: '正文字体', exact: true })
      .selectOption(defaultSettings.appearance.bodyFont);
    await settings.getByRole('button', { name: '外观与主题', exact: true }).click();
    await settings.getByRole('button', { name: '苔绿', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(out, 'dark.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 760));
    const savedNormal = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getNormalBounds(),
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await expect
      .poll(() =>
        app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      )
      .toBe(true);
    let closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.cm-content')).toContainText('从循环到累加');
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
    ).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
    await expect
      .poll(() =>
        app!.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds().width,
        ),
      )
      .toBe(savedNormal.width);
    expect(await readFile(file, 'utf8')).toBe(source);
    expect(errors).toEqual([]);
    await writeFile(
      path.join(out, 'report.json'),
      JSON.stringify(
        {
          reconfigurations,
          errors,
          sourceUnchanged: true,
          profile,
          version: (await page.evaluate(() => window.notes.bootstrap())).version,
        },
        null,
        2,
      ),
    );
    closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    app = undefined;
  } finally {
    await app?.close();
  }
});
