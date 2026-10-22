import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSettings } from '../src/shared/defaults';
import type { SessionState } from '../src/shared/types';

test('Yuanjian reuses the original default data directory after its display name changes', async () => {
  const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
  const fixture = await mkdtemp(path.join(project, '.test-data/更名兼容-'));
  const appData = path.join(fixture, 'app-data');
  const originalData = path.join(appData, '轻笺');
  await mkdir(originalData, { recursive: true });
  await writeFile(
    path.join(originalData, 'settings.json'),
    JSON.stringify({
      ...defaultSettings,
      appearance: { ...defaultSettings.appearance, mode: 'dark' },
    }),
  );
  await writeFile(
    path.join(originalData, 'session.json'),
    JSON.stringify({
      activeId: 'original-draft',
      tabs: [
        {
          id: 'original-draft',
          path: null,
          title: '更名前的草稿',
          content: '更名前尚未保存的中文内容',
          baseContent: '',
          hash: '',
          dirty: true,
          cursor: 4,
          scrollTop: 0,
          modifiedAt: 1,
          mode: 'live',
        },
      ],
    } satisfies SessionState),
  );
  await symlink(path.join(project, 'dist'), path.join(fixture, 'dist'), 'junction');
  await writeFile(
    path.join(fixture, 'package.json'),
    JSON.stringify({
      name: 'yuanjian-branding-check',
      productName: '鸢笺',
      version: '0.1.0',
      main: 'boot.cjs',
    }),
  );
  // Redirect the OS application-data root before loading the unchanged production entrypoint.
  await writeFile(
    path.join(fixture, 'boot.cjs'),
    `const {app}=require('electron');\napp.setPath('appData', ${JSON.stringify(appData)});\nrequire(${JSON.stringify(path.join(project, 'dist-electron/main.cjs'))});\n`,
  );
  const env: Record<string, string> = { LOCAL_NOTES_TEST: '1' };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({
      executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
      args: [fixture],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.locator('.cm-content')).toContainText('更名前尚未保存的中文内容', {
      timeout: 30000,
    });
    await expect(page).toHaveTitle('鸢笺 · Yuanjian');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    const boot = await page.evaluate(() => window.notes.bootstrap());
    expect(boot.dataDirectory).toBe(originalData);
    expect(await app.evaluate(({ app }) => app.getName())).toBe('鸢笺');
    expect(existsSync(path.join(appData, '鸢笺'))).toBe(false);
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await expect(page.locator('.settings-about')).toContainText('鸢笺');
    await expect(page.locator('.settings-about')).toContainText('Yuanjian');
    await page.screenshot({ path: path.join(project, '.test-data/yuanjian-settings.png') });
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await page.screenshot({ path: path.join(project, '.test-data/yuanjian-window.png') });
    const exited = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await exited;
    app = undefined;
    expect(
      JSON.parse(await readFile(path.join(originalData, 'session.json'), 'utf8')).tabs[0].content,
    ).toBe('更名前尚未保存的中文内容');
  } finally {
    await app?.close();
  }
});
