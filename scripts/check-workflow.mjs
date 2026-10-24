// Real App and editor, generated notes only, headless Edge; no Windows desktop control.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { fixtureGraphPlugin } from './fixture-graph-plugin.mjs';

const out = 'artifacts/workflow';
await mkdir(out, { recursive: true });
const bundle = await build({
  plugins: [fixtureGraphPlugin()],
  entryPoints: ['scripts/fixtures/workflow-app.jsx'],
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
      'src/styles/icons.css',
      'src/editor/editor.css',
      'src/components/quick-open.css',
    ].map((file) => readFile(file, 'utf8')),
  )
).join('\n');
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
  } else if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
    );
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function check(name, action, width = 1440) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(base);
      await page.locator('.cm-content').waitFor();
      await action(page);
      assert.deepEqual(errors, []);
      results.push({ name, passed: true, errors });
    } catch (error) {
      results.push({ name, passed: false, errors, message: error.stack });
    } finally {
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.close();
    }
  }
  const tabs = (page) => page.locator('.tabs-bar [role="tab"]');
  const tab = (page, name) => tabs(page).filter({ hasText: name });
  const titles = (page) => tabs(page).allTextContents();
  const settle = (page) =>
    page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  async function quick(page, query) {
    await page.keyboard.press('Control+p');
    const input = page.getByRole('combobox', { name: '按文件名或路径查找笔记' });
    await input.fill(query);
    await input.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await check('open-center-insert-reuse', async (page) => {
    await page.keyboard.press('Control+o');
    await expect(tab(page, 'Gamma')).toBeVisible();
    assert.deepEqual(await titles(page), ['Alpha', 'Gamma', 'Beta']);
    await expect.poll(() => page.evaluate(() => window.workflowFixture.centered)).toBe(1);
    await tab(page, 'Alpha').click();
    await page.keyboard.press('Control+o');
    await expect(tab(page, 'Gamma')).toHaveAttribute('aria-selected', 'true');
    assert.equal(await tabs(page).count(), 3);
    assert.equal(await page.evaluate(() => window.workflowFixture.centered), 1);
  });
  await check('quick-open-search-and-draft', async (page) => {
    await quick(page, 'Delta');
    await expect(tab(page, 'Delta')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+p');
    await page.getByRole('combobox').fill('does-not-exist');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeFocused();
    await quick(page, 'Alpha');
    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
  });
  async function dragBefore(page, moving, before) {
    const source = await tab(page, moving).boundingBox(),
      target = await tab(page, before).boundingBox();
    assert.ok(source && target);
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 3, target.y + target.height / 2, { steps: 8 });
  }
  await check('drag-preserves-editor-and-session', async (page) => {
    const original = await page.evaluate(() => window.workflowFixture.document());
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('拖动前的新输入');
    const cursor = await page.evaluate(() => window.workflowFixture.cursor());
    await dragBefore(page, 'Beta', 'Alpha');
    assert.deepEqual(await titles(page), ['Alpha', 'Beta']);
    await expect(page.locator('.tab-insertion-marker')).toBeVisible();
    await page.mouse.up();
    assert.deepEqual(await titles(page), ['Beta', 'Alpha']);
    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
    assert.equal(await page.evaluate(() => window.workflowFixture.cursor()), cursor);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.workflowFixture.document()), original);
    await expect
      .poll(() =>
        page.evaluate(() => window.workflowFixture.session?.tabs.map((item) => item.title)),
      )
      .toEqual(['Beta', 'Alpha']);
    await page.reload();
    await page.locator('.cm-content').waitFor();
    assert.deepEqual(await titles(page), ['Beta', 'Alpha']);
  });
  await check('drag-cancel-and-graph-order', async (page) => {
    await dragBefore(page, 'Beta', 'Alpha');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await titles(page), ['Alpha', 'Beta']);
    await dragBefore(page, 'Beta', 'Alpha');
    await page.mouse.move(400, 180);
    await page.mouse.up();
    assert.deepEqual(await titles(page), ['Alpha', 'Beta']);
    await page.getByRole('button', { name: '关系图谱', exact: true }).click();
    await expect(page.locator('.graph-canvas canvas').first()).toBeVisible();
    await tab(page, 'Alpha').click();
    await dragBefore(page, '关系图谱', 'Alpha');
    await page.mouse.up();
    assert.deepEqual(await titles(page), ['关系图谱', 'Alpha', 'Beta']);
    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+Shift+Tab');
    await expect(tab(page, '关系图谱')).toHaveAttribute('aria-selected', 'true');
  });
  await check('find-replace-undo-and-focus', async (page) => {
    await page.keyboard.press('Control+f');
    await page.getByRole('textbox', { name: '查找正文', exact: true }).fill('练习');
    await expect(page.getByRole('status', { name: '查找结果' })).toContainText('/ 35');
    await expect(page.getByRole('textbox', { name: '替换为', exact: true })).not.toBeVisible();
    await page.keyboard.press('Control+h');
    await page.getByRole('textbox', { name: '替换为', exact: true }).fill('记录');
    await page.getByRole('button', { name: '全部替换', exact: true }).click();
    assert.ok((await page.evaluate(() => window.workflowFixture.document())).includes('记录内容'));
    await page.keyboard.press('Escape');
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.keyboard.press('Control+z');
    assert.ok((await page.evaluate(() => window.workflowFixture.document())).includes('练习内容'));
  });
  await check('mixed-click-and-native-link-gesture', async (page) => {
    await quick(page, 'Links');
    const expected =
      (await page.evaluate(() => window.workflowFixture.document())).indexOf('目标') + 1;
    const point = await page.locator('.markdown-preview-block strong').evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild, 1);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + 0.1, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => window.workflowFixture.cursor()), expected);
    await page.locator('.markdown-preview-block').filter({ hasText: '尾段。' }).click();
    await page.getByRole('link', { name: '网站', exact: true }).click();
    assert.ok(
      !(await page.evaluate(() => window.workflowFixture.opened)).includes(
        'https://example.org/path',
      ),
    );
    await page.locator('.markdown-preview-block').filter({ hasText: '尾段。' }).click();
    await page.getByRole('link', { name: '网站', exact: true }).click({ modifiers: ['Control'] });
    await expect
      .poll(() => page.evaluate(() => window.workflowFixture.opened))
      .toContain('https://example.org/path');
  });
  await check('short-table-keyboard-and-source', async (page) => {
    await quick(page, 'Table');
    const last = page.getByRole('textbox', { name: '表格第 2 行第 2 列', exact: true });
    await last.fill('第二格');
    await last.press('Tab');
    const added = page.getByRole('textbox', { name: '表格第 3 行第 1 列', exact: true });
    await expect(added).toBeFocused();
    await added.fill('新行');
    assert.ok((await page.evaluate(() => window.workflowFixture.document())).includes('新行'));
    await added.press('Shift+Tab');
    await expect(last).toBeFocused();
    await last.fill('临时改动');
    await last.press('Escape');
    assert.ok(!(await page.evaluate(() => window.workflowFixture.document())).includes('临时改动'));
    assert.ok((await page.evaluate(() => window.workflowFixture.document())).includes('第二格'));
    await page.keyboard.press('Control+Shift+m');
    assert.ok((await page.evaluate(() => window.workflowFixture.document())).includes('新行'));
  });
  await check('close-reopen-position-and-fresh-undo', async (page) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' 保存后重开');
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => window.workflowFixture.saved.length)).toBe(1);
    await settle(page);
    const snapshot = await page.evaluate(() => ({
      source: window.workflowFixture.document(),
      cursor: window.workflowFixture.cursor(),
      scroll: document.querySelector('.cm-scroller').scrollTop,
    }));
    await page.keyboard.press('Control+w');
    await expect(tab(page, 'Alpha')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+t');
    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
    assert.equal(await page.evaluate(() => window.workflowFixture.document()), snapshot.source);
    assert.equal(await page.evaluate(() => window.workflowFixture.cursor()), snapshot.cursor);
    await settle(page);
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((element) => element.scrollTop))
      .toBeCloseTo(snapshot.scroll, 0);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.workflowFixture.document()), snapshot.source);
  });
  await check('long-note-session-scroll-and-undo', async (page) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' 会话末尾');
    await settle(page);
    const snapshot = await page.evaluate(() => ({
      source: window.workflowFixture.document(),
      cursor: window.workflowFixture.cursor(),
      scroll: document.querySelector('.cm-scroller').scrollTop,
    }));
    assert.ok(snapshot.scroll > 500);
    await tab(page, 'Beta').click();
    await tab(page, 'Alpha').click();
    await settle(page);
    assert.equal(await page.evaluate(() => window.workflowFixture.cursor()), snapshot.cursor);
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((element) => element.scrollTop))
      .toBeCloseTo(snapshot.scroll, 0);
    await page.getByRole('button', { name: '关系图谱', exact: true }).click();
    await expect(page.locator('.graph-canvas canvas').first()).toBeVisible();
    await tab(page, 'Alpha').click();
    await settle(page);
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((element) => element.scrollTop))
      .toBeCloseTo(snapshot.scroll, 0);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+z');
    assert.ok(!(await page.evaluate(() => window.workflowFixture.document())).includes('会话末尾'));
  });
  await check('batch-close-cancel-failure-and-recovery', async (page) => {
    await quick(page, 'Gamma');
    await quick(page, 'Delta');
    await quick(page, 'Gamma');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' 未保存内容');
    await tab(page, 'Alpha').click();
    async function closeRight() {
      await tab(page, 'Alpha').click({ button: 'right' });
      await page.getByRole('menuitem', { name: '关闭右侧标签', exact: true }).click();
    }
    await closeRight();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    assert.deepEqual(await titles(page), ['Alpha', 'Gamma', 'Delta', 'Beta']);
    await page.evaluate(() => {
      window.workflowFixture.failNextSave = true;
    });
    await closeRight();
    await page.getByRole('button', { name: '保存并关闭', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('自建写入失败');
    assert.deepEqual(await titles(page), ['Alpha', 'Gamma', 'Delta', 'Beta']);
    await closeRight();
    await page.getByRole('button', { name: '丢弃修改并关闭', exact: true }).click();
    await expect.poll(() => titles(page)).toEqual(['Alpha']);
    await page.keyboard.press('Control+Shift+t');
    await expect(tab(page, 'Beta')).toBeVisible();
    await page.keyboard.press('Control+Shift+t');
    await expect(tab(page, 'Delta')).toBeVisible();
    await page.keyboard.press('Control+Shift+t');
    await expect(tab(page, 'Gamma')).toBeVisible();
    assert.ok(
      !(await page.evaluate(() => window.workflowFixture.document())).includes('未保存内容'),
    );
  });
  await check('tab-context-copy-and-reveal', async (page) => {
    await tab(page, 'Alpha').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '复制文件路径', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.workflowFixture.copied))
      .toEqual(['D:/generated-workflow/Alpha.md']);
    await tab(page, 'Alpha').focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: '在文件夹中显示', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.workflowFixture.revealed))
      .toEqual(['D:/generated-workflow/Alpha.md']);
  });
  await check('heading-menu-convert-and-undo', async (page) => {
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Home');
    await page.getByRole('button', { name: '标题', exact: true }).click();
    await expect(page.getByRole('menu', { name: '标题级别' }).getByRole('menuitem')).toHaveCount(7);
    await page.getByRole('menuitem', { name: 'H3 三级标题', exact: true }).click();
    assert.ok(
      (await page.evaluate(() => window.workflowFixture.document())).startsWith('### Alpha'),
    );
    await page.keyboard.press('Control+z');
    assert.ok((await page.evaluate(() => window.workflowFixture.document())).startsWith('# Alpha'));
    await page.getByRole('button', { name: '标题', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'H1 一级标题', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await page.getByRole('menuitem', { name: '正文', exact: true }).click();
    assert.ok((await page.evaluate(() => window.workflowFixture.document())).startsWith('Alpha'));
  });
  await check('reading-history-positions-and-forward-branch', async (page) => {
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await settle(page);
    const alpha = await page.evaluate(() => ({
      cursor: window.workflowFixture.cursor(),
      scroll: document.querySelector('.cm-scroller').scrollTop,
    }));
    await tab(page, 'Beta').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    const beta = await page.evaluate(() => window.workflowFixture.cursor());
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
    await settle(page);
    assert.equal(await page.evaluate(() => window.workflowFixture.cursor()), alpha.cursor);
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((element) => element.scrollTop))
      .toBeCloseTo(alpha.scroll, 0);
    await page.keyboard.press('Alt+ArrowRight');
    await expect(tab(page, 'Beta')).toHaveAttribute('aria-selected', 'true');
    assert.equal(await page.evaluate(() => window.workflowFixture.cursor()), beta);
    await page
      .locator('#right-outline')
      .getByRole('button', { name: '第二节', exact: true })
      .click();
    const heading = await page.evaluate(() => window.workflowFixture.cursor());
    assert.notEqual(heading, beta);
    await page.keyboard.press('Alt+ArrowLeft');
    assert.equal(await page.evaluate(() => window.workflowFixture.cursor()), beta);
    await quick(page, 'Gamma');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(tab(page, 'Gamma')).toHaveAttribute('aria-selected', 'true');
  });
  for (const width of [1440, 800, 600])
    await check(
      `header-${width}`,
      async (page) => {
        const region = page.locator('.window-drag-region');
        const box = await region.boundingBox();
        assert.ok(box);
        assert.equal(Math.round(box.height), 44);
        assert.ok(box.width >= (width > 1000 ? 120 : 64));
        assert.equal(
          await region.evaluate((element) =>
            getComputedStyle(element).getPropertyValue('-webkit-app-region'),
          ),
          'drag',
        );
        if (width <= 1000) {
          await expect(
            page.getByRole('button', { name: '进入便笺模式', exact: true }),
          ).toBeVisible();
          await page.getByRole('button', { name: '更多操作', exact: true }).click();
          await expect(page.getByRole('menuitem', { name: /打开设置/ })).toBeVisible();
        }
        await page.screenshot({ path: `${out}/header-${width}-details.png` });
      },
      width,
    );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    `${out}/results.json`,
    JSON.stringify({ headless: true, generatedNotes: true, results }, null, 2),
  );
}
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
