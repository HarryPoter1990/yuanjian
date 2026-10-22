import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSettings } from '../src/shared/defaults';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const executable = path.join(project, 'release/win-unpacked/轻笺.exe');
test.skip(
  !existsSync(executable),
  'Build the Windows package before running the packaged binary check.',
);

test('packaged executable runs offline and preserves notes, history, fonts and drafts across an app file replacement', async () => {
  const root = path.join(path.dirname(executable), '.test-data');
  await mkdir(root, { recursive: true });
  const fixture = await mkdtemp(path.join(root, '打包验收-'));
  const profile = path.join(fixture, 'profile');
  const notes = path.join(fixture, '笔记');
  await mkdir(profile);
  await mkdir(notes);
  const file = path.join(notes, '打包中文.md');
  await writeFile(file, '# 原始笔记\n\n原始中文。\n');
  await writeFile(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      ...defaultSettings,
      roots: [notes],
      appearance: { ...defaultSettings.appearance, mode: 'dark' },
    }),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.LOCAL_NOTES_TEST = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app: ElectronApplication | undefined;
  const launch = async () => {
    app = await _electron.launch({
      executablePath: executable,
      args: [`--data-dir=${profile}`],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeVisible({
      timeout: 30000,
    });
    return page;
  };
  const close = async () => {
    const exited = app!.waitForEvent('close');
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await exited;
    app = undefined;
  };
  try {
    const started = Date.now();
    let page = await launch();
    const startupMs = Date.now() - started;
    const memory = await app!.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((process) => ({ type: process.type, workingSetKB: process.memory.workingSetSize })),
    );
    await app!.evaluate(({ session }) =>
      session.defaultSession.enableNetworkEmulation({ offline: true }),
    );
    await page.getByRole('button', { name: '打包中文.md', exact: true }).click();
    await expect(page.getByRole('tab', { name: '打包中文', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '即时排版', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('离线追加。');
    await expect.poll(() => readFile(file, 'utf8')).toContain('离线追加。');
    const imported = await (async () => {
      const source = path.join(
        project,
        'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
      );
      await app!.evaluate(({ dialog }, selected) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
      }, source);
      return page.evaluate(() => window.notes.importFonts());
    })();
    expect(imported).toHaveLength(1);
    expect(
      (await page.evaluate((file) => window.notes.listHistory(file), file)).length,
    ).toBeGreaterThan(0);
    await page.getByRole('button', { name: '新建空白笔记', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('尚未保存的中文草稿');
    await close();
    async function fingerprints() {
      const files: string[] = [file, path.join(profile, 'settings.json')];
      async function collect(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const current = path.join(directory, entry.name);
          if (entry.isDirectory()) await collect(current);
          else files.push(current);
        }
      }
      await collect(path.join(profile, 'history'));
      await collect(path.join(profile, 'fonts'));
      return Object.fromEntries(
        await Promise.all(
          files.sort().map(async (file) => [
            file,
            createHash('sha256')
              .update(await readFile(file))
              .digest('hex'),
          ]),
        ),
      );
    }
    const before = await fingerprints();
    const resource = path.join(path.dirname(executable), 'resources/app.asar');
    const backup = path.join(fixture, 'app-replacement.asar');
    await copyFile(resource, backup);
    await copyFile(backup, resource);
    expect(await fingerprints()).toEqual(before);
    page = await launch();
    await expect(page.locator('.cm-content')).toContainText('尚未保存的中文草稿');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    const state = await page.evaluate(() => window.notes.bootstrap());
    expect(state.dataDirectory).toBe(profile);
    expect(state.fonts.some((font) => font.id === imported[0].id)).toBe(true);
    expect(
      (await page.evaluate((file) => window.notes.listHistory(file), file)).length,
    ).toBeGreaterThan(0);
    await close();
    expect(await fingerprints()).toEqual(before);
    await writeFile(
      path.join(project, 'artifacts/packaged-verification.json'),
      JSON.stringify(
        {
          offline: true,
          appFileReplacement: true,
          checkedFiles: Object.keys(before).length,
          noteHistoryFontsUnchanged: true,
          draftRestored: true,
          installedIntoSystem: false,
          startupWithAutomationMs: startupMs,
          processMemory: memory,
        },
        null,
        2,
      ),
    );
  } finally {
    await app?.close();
    if (path.dirname(fixture) !== root || !fixture.startsWith(path.join(project, 'release')))
      throw new Error('Unexpected fixture cleanup path');
    await rm(fixture, { recursive: true, force: true });
  }
});
