// Isolated generated fonts in headless Edge; never enumerates system fonts or reads user settings.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const out = 'artifacts/font-settings';
await mkdir(out, { recursive: true });
const bundle = await build({
  entryPoints: ['scripts/fixtures/font-settings.jsx'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
});
const css = (
  await Promise.all(
    [
      'src/styles/app.css',
      'src/styles/writing.css',
      'src/styles/icons.css',
      'src/components/fonts.css',
    ].map((file) => readFile(file, 'utf8')),
  )
).join('\n');
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].text);
  } else if (request.url === '/app.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end(css);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>',
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const results = [];
let browser;
const chooser = (page) => page.getByRole('dialog', { name: '选择正文字体', exact: true });
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function check(name, action, width = 1200, height = 850) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
    });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole('button', { name: '打开字体设置', exact: true }).click();
      if (width <= 650) await page.locator('.settings-categories-toggle').click();
      await page
        .locator('.settings-nav')
        .getByRole('button', { name: '字体管理', exact: true })
        .click();
      await action(page);
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.fontFixture.errors), []);
      results.push({ name, passed: true, errors });
    } catch (error) {
      results.push({ name, passed: false, errors, message: error.stack });
    } finally {
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.close();
    }
  }
  await check('grouped-browser-search-removal', async (page) => {
    await expect(page.locator('.font-row')).toHaveCount(6);
    await expect(page.getByRole('button', { name: '系统字体', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.getByRole('textbox', { name: '搜索字体', exact: true }).fill('System Font 349');
    await expect(page.locator('.font-row')).toHaveCount(1);
    await page.getByRole('textbox', { name: '搜索字体', exact: true }).fill('');
    await expect(page.locator('.font-row')).toHaveCount(6);
    await page.getByRole('button', { name: '系统字体', exact: true }).click();
    const region = page.getByRole('region', { name: '系统字体预览', exact: true });
    await expect(region).toBeVisible();
    assert.ok(
      await region.evaluate(
        (node) => node.clientHeight <= 262 && node.scrollHeight > node.clientHeight,
      ),
    );
    await page.getByRole('button', { name: '移除 Imported Font', exact: true }).first().click();
    await expect(page.getByRole('button', { name: '移除 Imported Font', exact: true })).toHaveCount(
      1,
    );
    assert.deepEqual(await page.evaluate(() => window.fontFixture.removed), ['owned-a']);
    assert.equal(await page.evaluate(() => window.fontFixture.saved.length), 0);
  });
  await check('native-popover-search-keyboard', async (page) => {
    await page.getByRole('button', { name: '正文字体', exact: true }).click();
    const panel = chooser(page);
    await expect(panel).toBeVisible();
    assert.ok(await panel.evaluate((node) => node.matches(':popover-open')));
    const input = panel.getByRole('combobox', { name: '搜索正文字体', exact: true });
    await expect(input).toBeFocused();
    await expect(panel.getByRole('option').filter({ hasText: 'Inter Variable' })).toHaveCount(1);
    await input.fill('System Font 34');
    await expect(panel.getByRole('option')).toHaveCount(10);
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(panel).toHaveCount(0);
    assert.notEqual(
      await page.evaluate(() => window.fontFixture.settings.appearance.bodyFont),
      'System Font 341',
    );
    await expect(page.getByRole('button', { name: '正文字体', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '应用外观', exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.fontFixture.settings.appearance.bodyFont),
      'System Font 341',
    );
    await page.getByRole('button', { name: '正文字体', exact: true }).click();
    await expect(chooser(page).getByRole('group', { name: '当前使用', exact: true })).toContainText(
      'System Font 341',
    );
    await chooser(page).getByRole('combobox').press('Escape');
    await expect(chooser(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  });
  await check('light-dismiss-and-tab-focus', async (page) => {
    await page.getByRole('button', { name: '正文字体', exact: true }).click();
    await chooser(page).getByRole('combobox').press('Tab');
    await expect(
      chooser(page).getByRole('button', { name: '显示全部系统字体', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(chooser(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '标题字体', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '标题字体', exact: true }).click();
    await page.getByRole('button', { name: '正文字体', exact: true }).click();
    await expect(chooser(page)).toBeVisible();
    await expect(page.getByRole('dialog', { name: '选择标题字体', exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.fontFixture.saved.length), 0);
  });
  for (const width of [320, 768, 1024, 1440])
    await check(
      `geometry-${width}`,
      async (page) => {
        if (width === 1024) await page.evaluate(() => window.fontFixture.setDark(true));
        for (const label of ['界面字体', '正文字体', '标题字体', '代码字体']) {
          await page.getByRole('button', { name: label, exact: true }).click();
          const panel = page.getByRole('dialog', { name: `选择${label}`, exact: true });
          await expect(panel).toBeVisible();
          const box = await panel.boundingBox();
          assert.ok(
            box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 600,
            JSON.stringify(box),
          );
          const header = await page.locator('.modal-header').boundingBox();
          assert.ok(
            box.y >= header.y + header.height,
            'Font popup covers the settings dismissal header',
          );
          assert.ok(
            await panel
              .getByRole('combobox')
              .evaluate(
                (node) =>
                  document.elementFromPoint(
                    node.getBoundingClientRect().x + 12,
                    node.getBoundingClientRect().y + 12,
                  ) === node,
              ),
          );
          await panel.getByRole('combobox').press('Escape');
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.getByRole('button', { name: '正文字体', exact: true }).click();
      },
      width,
      600,
    );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ headless: true, fonts: 'generated only', results }, null, 2),
  );
}
for (const result of results)
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.message ? '\n' + result.message : ''}`,
  );
assert.ok(
  results.length === 7 && results.every((result) => result.passed),
  'Font settings browser checks failed',
);
