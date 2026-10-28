import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out = process.env.WORKSPACE_CHECK_OUT || 'artifacts/integration-2026-10-28/browser';
await mkdir(out, { recursive: true });
const entry = `${out}/workspace.html`;
await writeFile(
  entry,
  '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>生成笔记的工作区检查</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/note-syntax-app.jsx"></script></body></html>',
);
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, strictPort: true },
  optimizeDeps: { entries: [path.resolve(entry)] },
});
await server.listen();
const address = server.httpServer.address(),
  base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 920 } });
const report = {
  checks: [],
  errors: [],
  externalRequests: [],
  environment:
    'Real App and editor, generated in-memory desktop API, headless Edge; no system clipboard or real notes',
};
async function check(name, run) {
  if (process.env.WORKSPACE_CHECK_FILTER && !name.includes(process.env.WORKSPACE_CHECK_FILTER))
    return;
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push({ name, message: error.message }));
  await page.route('**/*', (route) => {
    if (/^https?:/.test(route.request().url()) && !route.request().url().startsWith(base)) {
      report.externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  try {
    await page.goto(`${base}/${entry}`);
    await page.waitForFunction(() => window.noteIntegration?.view());
    await expect(page.locator('.note-embed-body').first()).toContainText('未保存的新定义');
    await page.evaluate(() => document.fonts.ready);
    await run(page);
    assert.deepEqual(await page.evaluate(() => window.noteIntegration.unknown), []);
    report.checks.push({ name, passed: true });
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
    await page.screenshot({ path: `${out}/failure-${report.checks.length}.png` });
  } finally {
    await page.close();
  }
}
const state = (page) => page.evaluate(() => window.noteIntegration.state());
async function mode(page, label) {
  await page.getByRole('button', { name: '切换编辑模式', exact: true }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function point(page, word, offset, scope = '.cm-content') {
  return page.locator(scope).evaluate(
    (root, { word, offset }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent.indexOf(word);
        if (at < 0 || node.parentElement.closest('.katex')) continue;
        const range = document.createRange();
        range.setStart(node, at + offset);
        range.setEnd(node, at + offset + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + Math.min(0.4, rect.width / 4), y: rect.top + rect.height / 2 };
      }
      throw Error('Visible text not found: ' + word);
    },
    { word, offset },
  );
}
try {
  await check(
    'workspace renders note syntax and preserves source without experimental props',
    async (page) => {
      await expect(page.locator('.prototype-highlight')).toHaveText('保留重点');
      await expect(page.locator('.note-toc a').first()).toContainText('工作区笔记');
      const before = await state(page);
      await page.waitForTimeout(1100);
      assert.equal((await state(page)).source, before.source);
      assert.ok(!(await page.locator('.cm-content').innerText()).includes('隐藏备注'));
    },
  );
  await check('real pointer enters formatted text at its exact source character', async (page) => {
    const before = await state(page),
      at = await point(page, '加粗文字', 1);
    await page.mouse.click(at.x, at.y);
    assert.equal((await state(page)).head, before.source.indexOf('加粗文字') + 1);
    await page.keyboard.insertText('中文');
    assert.equal(
      (await state(page)).source,
      before.source.slice(0, before.source.indexOf('加粗文字') + 1) +
        '中文' +
        before.source.slice(before.source.indexOf('加粗文字') + 1),
    );
    await page.keyboard.press('Control+z');
    assert.equal((await state(page)).source, before.source);
  });
  for (const reversed of [false, true])
    await check(
      `native cross-paragraph drag preserves anchor direction: ${reversed}`,
      async (page) => {
        const before = await state(page);
        const a = await point(page, '工作区笔记', 1),
          b = await point(page, '普通正文', 2);
        const start = reversed ? b : a,
          end = reversed ? a : b;
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 14 });
        await page.mouse.up();
        const selected = await state(page);
        assert.equal(
          selected.anchor,
          reversed
            ? before.source.indexOf('普通正文') + 2
            : before.source.indexOf('工作区笔记') + 1,
        );
        assert.equal(
          selected.head,
          reversed
            ? before.source.indexOf('工作区笔记') + 1
            : before.source.indexOf('普通正文') + 2,
        );
        assert.equal(selected.source, before.source);
      },
    );
  await check('local block links and TOC work in the full workspace', async (page) => {
    const before = await state(page);
    await page.locator('[data-link-target="#^home"]').click({ modifiers: ['Control'] });
    assert.equal((await state(page)).head, before.source.indexOf('接口定义这一段'));
    await page
      .locator('.note-toc a')
      .first()
      .click({ modifiers: ['Control'] });
    assert.equal((await state(page)).head, 0);
  });
  await check('original-note entry opens an existing dirty tab at the block', async (page) => {
    await page
      .locator('[data-link-target="sub/child.md#^definition"]')
      .click({ modifiers: ['Control'] });
    await expect(page.getByRole('tab', { name: /子笔记/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const opened = await state(page);
    assert.ok(opened.source.includes('未保存的新定义'));
    assert.equal(opened.head, opened.source.indexOf('未保存的新定义'));
    assert.deepEqual(await page.evaluate(() => window.noteIntegration.saved), []);
  });
  await check('embedded image resolution retains the child note origin', async (page) => {
    await expect(page.locator('.note-embed-body img')).toHaveJSProperty('naturalWidth', 960);
    assert.ok(
      await page.evaluate(() =>
        window.noteIntegration.assets.some(
          (item) => item.reference === 'images/child.png' && item.from.endsWith('/sub/child.md'),
        ),
      ),
    );
  });
  await check('embedded original entry navigates using the resolved note path', async (page) => {
    await page
      .locator('.note-embed-open')
      .first()
      .click({ modifiers: ['Control'] });
    await expect(page.getByRole('tab', { name: /子笔记/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    assert.ok((await state(page)).source.includes('未保存的新定义'));
  });
  await check(
    'inline link at the editing cursor opens with Control+Enter without changing text',
    async (page) => {
      const before = await state(page);
      const link = page.locator('[data-link-target="#^home"]');
      await link.click();
      await page.keyboard.press('Control+Enter');
      const current = await state(page);
      assert.equal(current.head, current.source.indexOf('接口定义这一段'));
      assert.equal(current.source, before.source);
    },
  );
  for (const [selector, partial, expected] of [
    ['.prototype-strong', false, '**加粗文字**'],
    ['.prototype-inline-math .katex-html', false, '$x+1$'],
    ['.prototype-inline-math .katex-html', true, 'x'],
  ])
    await check(`workspace copy preserves ${expected}`, async (page) => {
      const before = await state(page);
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.evaluate(
        ({ selector, partial }) => {
          const root = document.querySelector(selector);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const nodes = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode())
            if (node.textContent) nodes.push(node);
          const range = document.createRange(),
            last = partial ? nodes[0] : nodes.at(-1);
          range.setStart(nodes[0], 0);
          range.setEnd(last, last.textContent.length);
          const selection = document.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          root.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }));
        },
        { selector, partial },
      );
      await expect.poll(() => page.evaluate(() => window.noteIntegration.copies.length)).toBe(1);
      assert.equal(await page.evaluate(() => window.noteIntegration.copies[0].plain), expected);
      assert.equal((await state(page)).source, before.source);
    });
  await check('ordinary typing and cursor changes do not reload embedded files', async (page) => {
    const before = await page.evaluate(() => window.noteIntegration.reads.length);
    const at = await point(page, '普通正文', 2);
    await page.mouse.click(at.x, at.y);
    await page.keyboard.insertText('新增文字');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.noteIntegration.reads.length), before);
  });
  await check(
    'file change refreshes embedded content without changing the current note',
    async (page) => {
      const before = await state(page);
      await page.evaluate(() => window.noteIntegration.changeReference());
      await expect(page.locator('.note-embed-body').nth(1)).toContainText('磁盘参考已经更新');
      assert.equal((await state(page)).source, before.source);
    },
  );
  await check(
    'format menu inserts actual editable syntax and preserves separate undo',
    async (page) => {
      const before = await state(page);
      await page.getByRole('button', { name: '打开格式菜单', exact: true }).click();
      await page.getByLabel('插入 Markdown 语法').selectOption('callout');
      let selected = await state(page);
      assert.equal(selected.source.slice(selected.anchor, selected.head), '补充说明');
      await page.keyboard.insertText('自己填写');
      await page.keyboard.press('Control+z');
      assert.equal((await state(page)).source, selected.source);
      await page.keyboard.press('Control+z');
      assert.equal((await state(page)).source, before.source);
    },
  );
  await check(
    'reading and split keep the editor instance, undo and rendered syntax',
    async (page) => {
      const original = await page.locator('.cm-editor').elementHandle();
      await mode(page, '阅读');
      await expect(page.locator('.document-preview .note-callout')).toHaveCount(2);
      await expect(page.locator('.document-preview mark')).toHaveText('保留重点');
      await mode(page, '源码对照');
      await expect(page.locator('.document-preview .note-embed-body').first()).toContainText(
        '未保存的新定义',
      );
      await mode(page, '即时排版');
      assert.ok(await original.evaluate((node) => node === document.querySelector('.cm-editor')));
    },
  );
  for (const format of ['html', 'pdf'])
    await check(
      `actual export action resolves references and uses ${format} folding rules`,
      async (page) => {
        await page.getByRole('button', { name: '导出', exact: true }).click();
        await page
          .getByRole('button', { name: `导出 ${format.toUpperCase()}`, exact: true })
          .click();
        await expect.poll(() => page.evaluate(() => window.noteIntegration.exports.length)).toBe(1);
        const exported = await page.evaluate(() => window.noteIntegration.exports[0]);
        assert.equal(exported.format, format);
        assert.ok(exported.html.includes('未保存的新定义'));
        assert.ok(!exported.html.includes('隐藏备注'));
        const result = await page.evaluate((html) => {
          const node = document.createElement('div');
          node.innerHTML = html;
          return {
            folded: node.querySelectorAll('details[data-callout][open],details.note-details[open]')
              .length,
            images: [...node.querySelectorAll('img')].map((image) => image.getAttribute('src')),
          };
        }, exported.html);
        assert.equal(result.folded, format === 'pdf' ? 2 : 0);
        assert.ok(result.images.every((src) => src?.startsWith('data:image/')));
        await writeFile(`${out}/workspace-export.${format}.html`, exported.html);
      },
    );
  await check('new editing remains available in sticky mode and a narrow window', async (page) => {
    await page.getByRole('button', { name: '进入便笺模式', exact: true }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-window-mode', 'sticky');
    await page.setViewportSize({ width: 430, height: 760 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}/sticky.png` });
  });
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
assert.deepEqual(report.errors, []);
assert.deepEqual(report.externalRequests, []);
assert.ok(report.checks.length > 0, 'No workspace checks matched');
assert.ok(
  report.checks.every((item) => item.passed),
  'Workspace syntax integration has failures',
);
