import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSettings } from '../src/shared/defaults';

test('explicit online font download and image localization use real public resources', async () => {
  test.skip(
    process.env.LOCAL_NOTES_ONLINE_TEST !== '1',
    'Opt in to real third-party network downloads with LOCAL_NOTES_ONLINE_TEST=1.',
  );
  const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
  await mkdir(path.join(project, '.test-data'), { recursive: true });
  const fixture = await mkdtemp(path.join(project, '.test-data/联网验收-'));
  const profile = path.join(fixture, 'profile');
  await mkdir(profile);
  await writeFile(
    path.join(profile, 'settings.json'),
    JSON.stringify({ ...defaultSettings, roots: [fixture] }),
  );
  const url = 'https://raw.githubusercontent.com/microsoft/vscode/main/resources/linux/code.png';
  const file = path.join(fixture, '网络图片.md');
  await writeFile(file, `# 网络图片\n\n![开源软件图标](${url})\n`);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.LOCAL_NOTES_TEST = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({
      executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
      args: [project, `--data-dir=${profile}`],
      env,
    });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '打开设置', exact: true }).click({ timeout: 30000 });
    await page.getByRole('button', { name: '字体管理', exact: true }).click();
    const catalog = page.locator('.catalog-row').filter({ hasText: 'Fira Code' });
    await catalog.getByRole('button', { name: '下载', exact: true }).click();
    await expect(catalog.getByRole('button', { name: '下载', exact: true })).toBeDisabled({
      timeout: 65000,
    });
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.notes.getFonts())).some(
            (font) => font.name === 'Fira Code' && font.source === 'downloaded',
          ),
        { timeout: 65000 },
      )
      .toBe(true);
    await page.getByRole('combobox', { name: '代码字体' }).selectOption('Fira Code');
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.fonts).some(
            (font) => font.family.replace(/^"|"$/g, '') === 'Fira Code' && font.status === 'loaded',
          ),
        ),
      )
      .toBe(true);
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await page.getByRole('button', { name: '网络图片.md', exact: true }).click();
    await page.getByRole('button', { name: '笔记操作菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '网络图片本地化', exact: true }).click();
    await page.getByRole('button', { name: '下载整篇图片', exact: true }).click();
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 45000 }).not.toContain(url);
    const text = await readFile(file, 'utf8');
    expect(text).toContain('assets/');
    const fonts = await page.evaluate(() => window.notes.getFonts());
    const downloaded = fonts.find(
      (font) => font.name === 'Fira Code' && font.source === 'downloaded',
    )!;
    expect(
      (await readFile(downloaded.path!)).subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])),
    ).toBe(true);
    await writeFile(
      path.join(project, 'artifacts/online-verification.json'),
      JSON.stringify(
        {
          realFont: 'Fira Code',
          fontBytes: downloaded.bytes,
          realImageHost: 'raw.githubusercontent.com',
          localizedIntoAssets: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await app?.close();
  }
});
