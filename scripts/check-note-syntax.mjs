import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.env.SYNTAX_CHECK_OUT || 'artifacts/syntax-review-2026-10-28/browser';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1250, height: 950 } });
const report = {
  checks: [],
  errors: [],
  externalRequests: [],
  environment:
    'Headless Edge, generated notes and assets only; no real Windows IME or system clipboard',
};
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('request', (request) => {
  if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4192/'))
    report.externalRequests.push(request.url());
});
const reset = async (text, cursor = text.length, mode = 'live') =>
  page.evaluate(
    ({ text, cursor, mode }) => window.editorPrototype.reset(text, mode, cursor, true),
    { text, cursor, mode },
  );
const state = () => page.evaluate(() => window.editorPrototype.state());
async function check(name, run) {
  try {
    report.checks.push({ name, passed: true, details: await run() });
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
    await page.screenshot({ path: `${out}/failure-${report.checks.length}.png` });
  }
}
try {
  await page.goto('http://127.0.0.1:4192/src/editor/editor.prototype.html');
  await page.waitForFunction(() => window.editorPrototype);
  await page.evaluate(() => document.fonts.ready);
  await check('standard heading, images, automatic links, quoted tasks and footnotes', async () => {
    const text =
      '中文标题\n====\n\n![学习流程](学习流程.png "示例说明")\n\n<https://example.com> 与 https://example.com\n\n> - [ ] 任务\n\n正文[^注]\n\n[^注]: 注释\n\n尾段';
    await reset(text);
    await expect(page.locator('.cm-heading-source-1')).toContainText('中文标题');
    await expect(page.locator('img[data-asset-src="学习流程.png"]')).toHaveJSProperty(
      'naturalWidth',
      960,
    );
    await expect(page.locator('img[data-asset-src]')).toHaveAttribute('title', '示例说明');
    assert.equal(await page.locator('[data-link-target="https://example.com"]').count(), 2);
    await page.locator('input[type="checkbox"]').check();
    assert.ok((await state()).source.includes('> - [x] 任务'));
    await expect(page.locator('sup[data-footnote-ref="注"] a')).toBeVisible();
  });
  await check('highlight reveals only itself and ordinary typing remains undoable', async () => {
    const text = '==重点== 与 H~2~O、x^2^\n\n尾段';
    await reset(text);
    await expect(page.locator('.prototype-highlight')).toHaveText('重点');
    await reset(text, 3);
    await expect(page.locator('.prototype-highlight')).toHaveText('==重点==');
    await expect(page.locator('.prototype-sub')).toHaveText('2');
    await page.keyboard.type('X');
    assert.equal((await state()).source, text.slice(0, 3) + 'X' + text.slice(3));
    await page.keyboard.press('Control+z');
    assert.equal((await state()).source, text);
  });
  await check('comments hide, reveal and never modify source', async () => {
    const text = '前文 %%内部\n\n备注%% 后文\n\n尾段';
    await reset(text);
    await expect(page.locator('.cm-content')).not.toContainText('内部');
    await reset(text, text.indexOf('内部') + 1);
    await expect(page.locator('.prototype-comment').first()).toContainText('内部');
    await expect(page.locator('.prototype-comment').nth(1)).toContainText('备注');
    assert.equal((await state()).source, text);
  });
  await check('nested folded callouts toggle without mutation and stay still at rest', async () => {
    const text = '> [!info]- 提示\n> 隐藏正文\n>\n> > [!tip]+ 第二层\n> > 子正文\n\n尾段';
    await reset(text);
    await expect(page.locator('.cm-content')).not.toContainText('隐藏正文');
    await page.getByRole('button', { name: '展开提示块', exact: true }).first().click();
    await expect(page.locator('.cm-content')).toContainText('隐藏正文');
    assert.equal((await state()).source, text);
    await reset(text, text.indexOf('隐藏正文') + 1);
    await expect(page.locator('.cm-content')).toContainText('隐藏正文');
    const before = await page.locator('.cm-content').innerText();
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('.cm-content').innerText(), before);
  });
  await check('TOC updates and Ctrl+click positions the caret', async () => {
    const text = '[TOC]\n\n# 中文标题\n\n## 重复\n\n## 重复\n\n尾段';
    await reset(text);
    assert.equal(await page.locator('.note-toc a').count(), 3);
    await page
      .locator('.note-toc a')
      .first()
      .click({ modifiers: ['Control'] });
    assert.equal((await state()).cursor, text.indexOf('# 中文标题'));
  });
  await check('fixture note and block embed render and open the original paragraph', async () => {
    const text = '![[接口.md#^definition]]\n\n![[学习流程.png|240]]\n\n尾段';
    await reset(text);
    await expect(page.locator('.note-embed-body')).toContainText('接口是一份行为契约');
    await expect(page.locator('img[data-asset-src]')).toHaveAttribute('width', '240');
    await page.locator('.note-embed-open').click({ modifiers: ['Control'] });
    const entered = await state();
    assert.ok(entered.source.includes('接口是一份行为契约'));
    assert.equal(entered.cursor, entered.source.indexOf('接口是一份行为契约'));
  });
  await check('local paragraph block reference navigates precisely', async () => {
    const text = '需要回来的一段。 ^home\n\n[[#^home|回到定义]]\n\n尾段';
    await reset(text);
    await page.locator('[data-link-target="#^home"]').click({ modifiers: ['Control'] });
    assert.equal((await state()).cursor, 0);
    assert.equal((await state()).source, text);
  });
  await check('missing, cyclic and duplicate references report explicit errors', async () => {
    await reset('![[缺失.md]]\n\n![[循环示例.md]]\n\n尾段');
    await expect(page.locator('.note-reference-error').first()).toContainText('找不到');
    await expect(page.locator('.note-reference-error').nth(1)).toContainText('循环');
    await reset('第一段 ^same\n\n第二段 ^same\n\n[[#^same|回去]]\n\n尾段');
    await page.locator('[data-link-target="#^same"]').click({ modifiers: ['Control'] });
    await expect(page.getByRole('status')).toContainText('重复');
  });
  await check(
    'insertion menu places selection inside editable content and supports undo',
    async () => {
      await reset('');
      await page.getByLabel('插入语法').selectOption({ label: '信息提示块' });
      const inserted = await state();
      assert.ok(inserted.source.includes('> [!info]'));
      assert.equal(inserted.source.slice(inserted.anchor, inserted.cursor), '补充说明');
      await page.keyboard.type('自己填写');
      await page.keyboard.press('Control+z');
      assert.equal((await state()).source, inserted.source);
      await page.keyboard.press('Control+z');
      assert.equal((await state()).source, '');
    },
  );
  await check(
    'copy returns original Markdown plus clean rendered HTML without touching clipboard',
    async () => {
      const text =
        '> [!info]- 提示标题\n> ==重点== H~2~O\n\n%%不导出%%\n\n![[接口.md#^definition]]';
      await reset(text);
      const copy = await page.evaluate(() => {
        const view = window.editorPrototype.view;
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        return window.editorPrototype.copy();
      });
      assert.equal(copy.markdown, text);
      assert.ok(copy.html.includes('<mark>重点</mark>'));
      assert.ok(copy.html.includes('提示标题'));
      assert.ok(!copy.html.includes('不导出'));
      assert.ok(!copy.html.includes('打开原笔记'));
    },
  );
  await check('nested callout code and table keep surrounding layout while editing', async () => {
    const text =
      '> [!info] 组合内容\n>\n> ```java\n> int number = 1;\n> ```\n>\n> | 名称 | 说明 |\n> | --- | --- |\n> | 数据行 | 可编辑 |\n\n尾段';
    await reset(text);
    await expect(page.locator('.code-container code')).toContainText('int number');
    await expect(page.locator('table')).toContainText('数据行');
    await page.locator('td').first().click();
    const entered = await state();
    assert.ok(
      entered.cursor >= text.indexOf('数据行') && entered.cursor <= text.indexOf('数据行') + 3,
      JSON.stringify({ cursor: entered.cursor, expected: text.indexOf('数据行') }),
    );
    assert.equal(entered.source, text);
    await page.keyboard.type('X');
    assert.ok((await state()).source.includes('X'));
    await page.keyboard.press('Control+z');
    assert.equal((await state()).source, text);
  });
  await check('repeated embeds have unique anchors in exported HTML', async () => {
    const rendered = await page.evaluate(() =>
      window.editorPrototype.render('![[接口.md]]\n\n![[接口.md]]'),
    );
    const ids = [...rendered.matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]);
    assert.ok(ids.length >= 4);
    assert.equal(new Set(ids).size, ids.length);
  });
  await check('reading toggles without destroying undo history', async () => {
    await reset('文字');
    await page.keyboard.type('X');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.prototype-reading')).toContainText('文字X');
    await page.getByRole('button', { name: '返回编辑', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+z');
    assert.equal((await state()).source, '文字');
  });
  await check('HTML export is portable offline, embeds content and preserves folding', async () => {
    const text =
      '# 导出示例\n\n[TOC]\n\n> [!info]- 折叠标题\n> 折叠内的正文。\n\n%%隐藏备注%%\n\n![[接口.md#^definition]]\n\n![[学习流程.png|240]]\n\n公式 $a^2+b^2=c^2$。\n\n<details>\n<summary>详细推导</summary>\n\n推导内容。\n\n</details>';
    await reset(text);
    const document = await page.evaluate(
      (text) => window.editorPrototype.exportHtml(text, 'html'),
      text,
    );
    await writeFile(`${out}/sample.html`, document);
    const exported = await browser.newPage();
    const requests = [];
    await exported.route('**/*', (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await exported.setContent(document);
    await exported.evaluate(() => document.fonts.ready);
    assert.equal(await exported.locator('details[open]').count(), 0);
    await expect(exported.locator('body')).not.toContainText('隐藏备注');
    await expect(exported.locator('.note-embed-body')).toContainText('接口是一份行为契约');
    await expect(exported.locator('img')).toHaveJSProperty('naturalWidth', 960);
    assert.equal(await exported.locator('.katex').count(), 1);
    assert.deepEqual(requests, []);
    await exported.screenshot({ path: `${out}/export-offline.png`, fullPage: true });
    await exported.close();
    return { bytes: document.length, requests };
  });
  await check('HTML download button uses the verified export path', async () => {
    await reset('# 下载检查\n\n==重点==');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出 HTML', exact: true }).click(),
    ]);
    assert.equal(download.suggestedFilename(), '鸢笺-语法示例.html');
    await download.saveAs(`${out}/download.html`);
  });
  await check('PDF uses expanded export document and contains generated content', async () => {
    const text =
      '# 导出检查\n\n> [!info]- 折叠标题\n> 不能丢失的正文。\n\n<details>\n<summary>详细推导</summary>\n\n推导过程。\n\n</details>\n\n%%不应导出%%\n\n![[接口.md#^definition]]\n\n![[学习流程.png|320]]\n\n$$\na^2+b^2=c^2\n$$';
    const document = await page.evaluate(
      (text) => window.editorPrototype.exportHtml(text, 'pdf'),
      text,
    );
    const printed = await browser.newPage();
    await printed.setContent(document);
    await printed.evaluate(() => window.document.fonts.ready);
    assert.equal(await printed.locator('details[open]').count(), 2);
    await expect(printed.locator('img')).toHaveJSProperty('naturalWidth', 960);
    const pdf = await printed.pdf({
      path: `${out}/sample.pdf`,
      format: 'A4',
      printBackground: true,
    });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 15000);
    await printed.close();
    return { bytes: pdf.length };
  });
  await reset(
    '> [!info] 学习笔记\n> ==先记录，再理解==。\n\nH~2~O 与 x^2^，也可以使用 **加粗**。\n\n![[学习流程.png|480]]\n\n![[接口.md#^definition]]\n\n继续输入。',
  );
  await page.screenshot({ path: `${out}/light.png`, fullPage: true });
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.screenshot({ path: `${out}/dark.png`, fullPage: true });
  await page.setViewportSize({ width: 430, height: 900 });
  await page.screenshot({ path: `${out}/narrow.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
assert.deepEqual(report.errors, []);
assert.deepEqual(report.externalRequests, []);
assert.ok(
  report.checks.every((check) => check.passed),
  'Syntax browser checks have failures',
);
