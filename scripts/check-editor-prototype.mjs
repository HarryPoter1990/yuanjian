import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'artifacts/editor-prototype-check';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const report = {
  checks: [],
  errors: [],
  environment: 'headless Edge; real editor and keyboard; generated notes; not real Windows IME',
};
page.on('pageerror', (e) => report.errors.push(e.message));
const reset = async (text, cursor = text.length, experimental = true, mode = 'live') => {
  await page.evaluate(
    ({ text, cursor, experimental, mode }) =>
      window.editorPrototype.reset(text, mode, cursor, experimental),
    { text, cursor, experimental, mode },
  );
  await page.waitForFunction(() => document.querySelector('.cm-editor'));
};
const state = () => page.evaluate(() => window.editorPrototype.state());
async function check(name, fn) {
  try {
    const details = await fn();
    report.checks.push({ name, passed: true, details });
  } catch (e) {
    report.checks.push({ name, passed: false, error: e.message });
  }
}
try {
  await page.goto('http://127.0.0.1:4192/src/editor/editor.prototype.html');
  await page.waitForFunction(() => window.editorPrototype);
  await page.evaluate(() => document.fonts.ready);
  await check('list navigation enters each item', async () => {
    const text = '# 开头\n\n- 第一项\n- 第二项\n- 第三项\n\n尾段';
    await reset(text);
    const positions = [];
    for (let n = 0; n < 7; n++) {
      await page.keyboard.press('ArrowUp');
      positions.push((await state()).cursor);
    }
    assert.ok(
      positions.some((p) => p >= text.indexOf('第二项') && p <= text.indexOf('第二项') + 3),
    );
    assert.equal((await state()).source, text);
    return positions;
  });
  for (const [name, block, inside] of [
    ['code', '```js\nlet a=1;\nlet b=2;\n```', 'let b'],
    ['formula', '$$\nx^2+y^2\n$$', 'x^2'],
  ]) {
    await check(`${name} arrow enters and exits`, async () => {
      const text = '# 开头\n\n' + block + '\n\n尾段';
      await reset(text);
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      const entered = await state();
      assert.ok(
        entered.cursor >= text.indexOf(inside) &&
          entered.cursor < text.indexOf(inside) + inside.length + 8,
      );
      await page.keyboard.press('ArrowDown');
      const exited = await state();
      assert.ok(exited.cursor > text.indexOf(block) + block.length);
      assert.equal(exited.source, text);
      return { entered: entered.cursor, exited: exited.cursor };
    });
  }
  await check('table arrow entry, movement and exit', async () => {
    const text =
      '开头\n\n| 名称 | 说明 |\n| --- | --- |\n| 第一项 | 内容 |\n| 第二项 | 内容 |\n\n尾段';
    await reset(text);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('textarea[data-row="2"][data-column="0"]')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('textarea[data-row="1"][data-column="0"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal((await state()).focused, true);
    assert.equal((await state()).source, text);
  });
  await check('table wrapped text uses visual lines before changing row', async () => {
    const long = '这一格有很多文字，自动折行时先在格内移动。'.repeat(12);
    const text = `开头\n\n| 名称 | 说明 |\n| --- | --- |\n| ${long} | 内容 |\n| 第二项 | 内容 |\n\n尾段`;
    await reset(text);
    const cell = page.locator('textarea[data-row="1"][data-column="0"]');
    await cell.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await expect(cell).toBeFocused();
  });
  await check('only current list item markers expand and tail stays stable', async () => {
    const text = '# 开头\n\n- 第一项\n\n- 第二项\n\n- 第三项\n\n尾段';
    await reset(text);
    const top = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('.cm-line')]
            .find((x) => x.textContent === '尾段')
            .getBoundingClientRect().top,
      );
    const before = await top();
    await page.locator('.cm-line').filter({ hasText: '第二项' }).click();
    assert.equal(await page.locator('.prototype-list-prefix').count(), 2);
    const after = await top();
    assert.ok(Math.abs(before - after) <= 2);
    return { before, after };
  });
  await check('inline styling remains around current format', async () => {
    const text = '普通 **加粗文字** 与 *斜体文字* 和 `code`。\n\n尾段';
    await reset(text);
    await expect(page.locator('.prototype-strong')).toHaveText('加粗文字');
    await page.locator('.prototype-strong').click();
    await expect(page.locator('.prototype-emphasis')).toHaveText('斜体文字');
    assert.equal((await state()).source, text);
  });
  await check('empty dollar pair input and deletion', async () => {
    await reset('');
    await page.keyboard.type('$');
    assert.equal((await state()).source, '$$');
    await page.keyboard.press('Backspace');
    assert.equal((await state()).source, '');
  });
  await check('blank nested quote exits gradually', async () => {
    await reset('> > ');
    await page.keyboard.press('Enter');
    assert.equal((await state()).source, '> ');
    await page.keyboard.press('Enter');
    assert.equal((await state()).source, '');
  });
  for (const opener of ['```js', '$$'])
    await check(`auto completes ${opener}`, async () => {
      await reset(opener);
      await page.keyboard.press('Enter');
      assert.equal(
        (await state()).source,
        opener + '\n\n' + (opener.startsWith('`') ? '```' : '$$'),
      );
      await page.keyboard.type('x');
      await page.keyboard.press('Control+z');
      assert.equal(
        (await state()).source,
        opener + '\n\n' + (opener.startsWith('`') ? '```' : '$$'),
      );
    });
  await check('old variant is an actual old behavior control', async () => {
    const text = '# 开头\n\n- 第一项\n- 第二项\n\n尾段';
    await reset(text, text.length, false);
    assert.equal(await page.locator('.prototype-list-prefix').count(), 0);
    assert.ok((await page.locator('.markdown-preview-block').count()) > 0);
  });
  await check('clicking inline math places typing inside its delimiters', async () => {
    const text = '前文 $x^2+y^2$ 后文。\n\n尾段';
    await reset(text);
    await page.locator('.prototype-inline-math .katex-html').click();
    const before = await state();
    assert.ok(before.cursor >= 4 && before.cursor <= 11);
    await page.keyboard.type('A');
    assert.match((await state()).source, /\$[^$]*A[^$]*\$/);
  });
  await check('reference links and wiki aliases retain display and navigation', async () => {
    const text =
      '前文 [示例链接][target] 与 [[另一篇#标题|别名]]。\n\n[target]: https://example.com\n\n尾段';
    await reset(text);
    const reference = page.locator('[data-link-target="https://example.com"]');
    await expect(reference).toHaveText('示例链接');
    await reference.click({ modifiers: ['Control'] });
    await expect(page.getByRole('status')).toContainText('https://example.com');
    const wiki = page.locator('[data-link-target="另一篇#标题"]');
    await expect(wiki).toHaveText('别名');
    await wiki.click({ modifiers: ['Control'] });
    await expect(page.getByRole('status')).toContainText('另一篇#标题');
    assert.equal((await state()).source, text);
  });
  await check('formula snippet completion has priority over list indentation', async () => {
    await reset('- 第一项\n- $');
    await page.keyboard.type('frac');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
    await page.keyboard.press('Tab');
    const s = await state();
    assert.ok(s.source.includes('\\frac'));
    assert.ok(!s.source.includes('\n  -'));
  });
  await reset(
    '# 编辑体验试用\n\n这里有 **加粗**、*斜体* 和 $a^2+b^2=c^2$。\n\n- 第一项\n- 第二项\n\n> 一段引用\n\n尾段',
  );
  await page.screenshot({ path: out + '/light.png', fullPage: true });
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('.editor-prototype')).not.toHaveCSS(
    'background-color',
    'rgb(250, 250, 250)',
  );
  await page.screenshot({ path: out + '/dark.png', fullPage: true });
  await page.setViewportSize({ width: 540, height: 720 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: out + '/narrow.png', fullPage: true });
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
assert.deepEqual(report.errors, []);
assert.ok(
  report.checks.every((c) => c.passed),
  'Prototype browser checks have failures',
);
