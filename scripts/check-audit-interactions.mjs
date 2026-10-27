// Real App/editor, headless browser, generated text and an in-memory desktop API.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { fixtureGraphPlugin } from './fixture-graph-plugin.mjs';

const output = 'artifacts/audit-interactions';
await mkdir(output, { recursive: true });
const bundle = await build({
  plugins: [fixtureGraphPlugin()],
  entryPoints: ['scripts/fixtures/audit-app.jsx'],
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
      'src/editor/editor.css',
    ].map((file) => readFile(file, 'utf8')),
  )
).join('\n');
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const server = createServer(async (request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].text);
  } else if (request.url === '/style.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end(css);
  } else if (request.url === '/yuanjian.png') {
    response.setHeader('Content-Type', 'image/png');
    response.end(await readFile('public/yuanjian.png'));
  } else if (request.url === '/' || request.url?.startsWith('/?')) {
    response.setHeader('Content-Type', 'text/html');
    response.end(html);
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const results = [],
  errors = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function pageFor(name, query = '') {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('pageerror', (error) => errors.push({ name, message: error.message }));
    await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
    await page.getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true }).waitFor();
    return page;
  }
  async function check(name, action, query = '') {
    const page = await pageFor(name, query);
    try {
      await action(page);
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, message: error.message });
    } finally {
      await page.close();
    }
  }
  await check('table-save-includes-focused-cell', async (page) => {
    await page
      .getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true })
      .fill('格内保存新文字');
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => page.evaluate(() => window.auditFixture.stored.content))
      .toContain('格内保存新文字');
  });
  await check('table-mode-switch-and-undo-preserve-input', async (page) => {
    await page
      .getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true })
      .fill('切换前新文字');
    await page.keyboard.press('Control+Shift+m');
    await expect
      .poll(() => page.evaluate(() => window.auditFixture.document()))
      .toContain('切换前新文字');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+z');
    await expect
      .poll(() => page.evaluate(() => window.auditFixture.document()))
      .toContain('| 旧值 | 内容 |');
  });
  await check('table-close-preserves-focused-cell', async (page) => {
    await page
      .getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true })
      .fill('关闭前新文字');
    await page.evaluate(() => window.auditFixture.closeRequested());
    await expect.poll(() => page.evaluate(() => window.auditFixture.closed)).toBe(true);
    assert.ok(
      (await page.evaluate(() => window.auditFixture.stored.content)).includes('关闭前新文字'),
    );
    assert.ok(
      JSON.stringify(await page.evaluate(() => window.auditFixture.session)).includes(
        '关闭前新文字',
      ),
    );
  });
  await check(
    'crlf-link-insertion',
    async (page) => {
      await page.getByRole('button', { name: '链接', exact: true }).click();
      await page.getByRole('textbox', { name: '链接显示文字', exact: true }).fill('新链接');
      await page
        .getByRole('textbox', { name: '链接目标', exact: true })
        .fill('https://example.com/');
      await page.getByRole('button', { name: '插入链接', exact: true }).click();
      assert.ok(
        (await page.evaluate(() => window.auditFixture.document())).includes(
          '[新链接](https://example.com/)',
        ),
      );
    },
    '?crlf',
  );
  await check('settings-search-locates-concrete-setting', async (page) => {
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索设置', exact: true }).fill('自动保存');
    await page.getByRole('button', { name: /编辑与文件 · 自动保存/ }).click();
    const target = page.locator('[data-setting-label="自动保存"]');
    await expect(target).toHaveAttribute('data-setting-highlighted', 'true');
    await expect(target.getByRole('switch', { name: '自动保存', exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/settings-located.png` });
  });
  await check('settings-exclusion-Enter-keeps-editable-line', async (page) => {
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑与文件', exact: true }).click();
    const input = page.getByRole('textbox', { name: '索引排除目录', exact: true });
    const before = await input.inputValue();
    await input.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    assert.equal(await input.inputValue(), before + '\n');
    await page.keyboard.insertText('自建排除目录');
    assert.equal(await input.inputValue(), before + '\n自建排除目录');
  });
  await check('native-close-keeps-unblurred-exclusion-input', async (page) => {
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑与文件', exact: true }).click();
    const input = page.getByRole('textbox', { name: '索引排除目录', exact: true });
    await input.fill((await input.inputValue()) + '\n关闭前新目录');
    await page.evaluate(() => window.auditFixture.closeRequested());
    await expect.poll(() => page.evaluate(() => window.auditFixture.closed)).toBe(true);
    assert.ok(
      (await page.evaluate(() => window.auditFixture.settings.excluded)).includes('关闭前新目录'),
    );
  });
  await check(
    'settings-write-failure-blocks-native-close',
    async (page) => {
      await page.getByRole('button', { name: '打开设置', exact: true }).click();
      await page.getByRole('button', { name: '编辑与文件', exact: true }).click();
      const input = page.getByRole('textbox', { name: '索引排除目录', exact: true });
      await input.fill((await input.inputValue()) + '\n必须保留的新目录');
      await page.evaluate(() => window.auditFixture.closeRequested());
      await expect(
        page
          .getByRole('dialog', { name: '设置', exact: true })
          .locator('.modal-feedback.inline-error'),
      ).toContainText('关闭前保存失败，窗口已保留：自建设置写入失败');
      assert.equal(await page.evaluate(() => window.auditFixture.closed), false);
      assert.ok((await input.inputValue()).includes('必须保留的新目录'));
    },
    '?settings-fail',
  );
  await check('path-with-spaces-has-valid-tab-association', async (page) => {
    const association = await page.locator('#document-panel').evaluate((panel) => {
      const ids = panel.getAttribute('aria-labelledby').split(/\s+/);
      return {
        count: ids.length,
        resolved: ids.every((id) => document.getElementById(id)?.getAttribute('role') === 'tab'),
      };
    });
    assert.equal(association.count, 1);
    assert.equal(association.resolved, true);
  });
  await check(
    'metadata-focus-reveals-source-before-delete',
    async (page) => {
      const before = await page.evaluate(() => window.auditFixture.document());
      await page.locator('.cm-content').focus();
      await expect(page.locator('.cm-content')).toContainText('tags: [自建]');
      await page.keyboard.press('Delete');
      assert.equal(await page.evaluate(() => window.auditFixture.document()), before.slice(1));
    },
    '?metadata-zero',
  );
  await check(
    'metadata-keyboard-navigation-reveals-source',
    async (page) => {
      const before = await page.evaluate(() => window.auditFixture.document());
      await expect(
        page.getByRole('button', { name: '展开原始 YAML 属性', exact: true }),
      ).toBeVisible();
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.cm-content')).toContainText('tags: [自建]');
      await page.keyboard.press('Delete');
      assert.equal(
        await page.evaluate(() => window.auditFixture.document()),
        before.slice(0, 1) + before.slice(2),
      );
    },
    '?metadata',
  );
  await check('note-menu-keyboard-and-focus-return', async (page) => {
    const trigger = page.getByRole('button', { name: '笔记操作菜单', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
  await check(
    'mode-control-survives-hidden-toolbar',
    async (page) => {
      await expect(page.locator('.editor-toolbar')).toHaveCount(0);
      const mode = page.getByRole('button', { name: '即时排版', exact: true });
      await expect(mode).toBeVisible();
      await mode.click();
      await expect(page.getByRole('button', { name: '源码', exact: true })).toBeVisible();
    },
    '?toolbar-hidden',
  );
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        headless: true,
        realApp: true,
        desktopAPI: 'in-memory',
        realWindowsIME: false,
        nativeWindowLifecycle: false,
        results,
        errors,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ results, errors }, null, 2));
if (errors.length || results.some((result) => !result.passed)) process.exitCode = 1;
