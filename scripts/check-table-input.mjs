import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
// Real table controls and physical editing keys in headless Edge; never starts Electron.
const out = 'artifacts/table-input';
await mkdir(out, { recursive: true });
const bundle = await build({
  entryPoints: ['scripts/fixtures/table-input.jsx'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
});
const css = (
  await Promise.all(
    ['src/styles/app.css', 'src/styles/icons.css', 'src/editor/editor.css'].map((file) =>
      readFile(file, 'utf8'),
    ),
  )
).join('\n');
const server = createServer((req, res) => {
  if (req.url === '/app.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(bundle.outputFiles[0].text);
  } else if (req.url === '/style.css') {
    res.setHeader('Content-Type', 'text/css');
    res.end(
      css + '\nbody{margin:0;font:16px/1.7 sans-serif}.markdown-editor{height:650px;width:100%;}',
    );
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>',
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
const results = [],
  errors = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  async function run(name, action) {
    try {
      await action();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, message: error.stack });
    }
    await page.screenshot({ path: `${out}/native-${name}.png` });
  }
  const source = '| A | B |\n| --- | --- |\n| first<br><br>second | 2 |\n\n尾段';
  await run('multiline-keyboard', async () => {
    await page.evaluate((source) => window.tableInputFixture.reset(source), source);
    const input = page.getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true });
    await input.waitFor();
    assert.equal(await input.inputValue(), 'first\n\nsecond');
    await input.focus();
    await input.evaluate((input) => input.setSelectionRange(5, 5));
    await page.keyboard.press('Shift+Enter');
    assert.equal(await input.inputValue(), 'first\n\n\nsecond');
    await expect(input).toBeFocused();
    assert.ok(
      (await page.evaluate(() => window.tableInputFixture.source())).includes(
        'first<br><br><br>second',
      ),
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.tableInputFixture.source()), source);
  });
  await run('matrix-confirm-and-native-undo', async () => {
    const original = '| A | B |\n| --- | --- |\n| keep | old |\n\n尾段';
    await page.evaluate((source) => window.tableInputFixture.reset(source), original);
    const input = page.getByRole('textbox', { name: '表格第 2 行第 2 列', exact: true });
    await input.waitFor();
    await input.focus();
    await page.evaluate(() => window.tableInputFixture.paste('', 'x\ty'));
    await expect(page.getByRole('alertdialog')).toBeVisible();
    assert.equal(await page.evaluate(() => window.tableInputFixture.source()), original);
    await page.getByRole('button', { name: '覆盖并粘贴', exact: true }).click();
    await expect(input).toHaveValue('x');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.tableInputFixture.source()), original);
  });
  await run('wrap-resize', async () => {
    const source = '| A |\n| --- |\n| ' + '很长的单元格文字。'.repeat(35) + '<br>下一行 |\n\n尾段';
    await page.evaluate((source) => window.tableInputFixture.reset(source), source);
    const input = page.getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true });
    await input.waitFor();
    await page.setViewportSize({ width: 420, height: 800 });
    await expect
      .poll(() =>
        input.evaluate((input) => ({
          clipped: input.scrollHeight > input.clientHeight + 2,
          height: input.clientHeight,
        })),
      )
      .toMatchObject({ clipped: false });
  });
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    `${out}/native-widget-results.json`,
    JSON.stringify(
      { headless: true, realSystemClipboard: false, realWindowsIME: false, results, errors },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ results, errors }, null, 2));
if (results.some((result) => !result.passed) || errors.length) process.exitCode = 1;
