import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('development server uses a CSP nonce and an isolated desktop profile', async () => {
  const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
  await mkdir(path.join(project, '.test-data'), { recursive: true });
  const profile = await mkdtemp(path.join(project, '.test-data/dev-check-'));
  const server = await createServer({
    configFile: path.join(project, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'warn',
  });
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Development server did not bind');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env))
      if (value !== undefined) env[key] = value;
    env.LOCAL_NOTES_TEST = '1';
    env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${address.port}`;
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
      args: [project, `--data-dir=${profile}`],
      env,
    });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeVisible({
      timeout: 10000,
    });
    expect((await page.evaluate(() => window.notes.bootstrap())).dataDirectory).toBe(profile);
    expect(await page.locator('script[nonce]').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await server.close();
  }
});
