// Uses only a headless Edge and generated in-memory notes; never starts Electron.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [
    {
      name: 'isolated-editor-input-fixture',
      configureServer(server) {
        server.middlewares.use('/__editor_input', (_request, response) => {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(
            '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/editor-input.jsx"></script></body></html>',
          );
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 0,
    watch: { ignored: ['**/.test-data/**', '**/dist/**', '**/release/**'] },
  },
});
await server.listen();
let browser;
const results = [];
const errors = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
    reducedMotion: 'no-preference',
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__editor_input`);
  await expect(page.locator('.cm-content')).toBeVisible();
  const reset = (source, mode, from, to) =>
    page.evaluate(
      ({ source, mode, from, to }) => window.editorInputFixture.reset(source, mode, from, to),
      { source, mode, from, to },
    );
  async function check(name, mode, expected, cursor) {
    await expect
      .poll(() => page.evaluate(() => window.editorInputFixture.state().source))
      .toBe(expected);
    const actual = await page.evaluate(() => window.editorInputFixture.state());
    if (cursor !== undefined) assert.equal(actual.selection.ranges[0].head, cursor, name);
    assert.ok(actual.focused, `${name}: editor must retain focus`);
    results.push({ name, mode, ...actual });
  }
  for (const mode of ['live', 'source']) {
    await reset('', mode);
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    await page.keyboard.type('def');
    await page.keyboard.press('Backspace');
    await check('plain Enter and Backspace', mode, 'abc\nde');
    await page.keyboard.press('Home');
    await page.keyboard.press('Delete');
    await check('plain forward Delete', mode, 'abc\ne');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('中文替换');
    await check('replace selection with Unicode text (not IME)', mode, '中文替换');

    await reset('- item', mode);
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    await check('continue Markdown list', mode, '- item\n- next');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await check('leave empty Markdown list item', mode, '- item\n- next\n');

    const code = '```js\nconst x = 1;\n```';
    const offset = code.indexOf(';') + 1;
    await reset(code, mode, offset);
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    await check(
      'Enter within fenced code',
      mode,
      code.slice(0, offset) + '\nnext' + code.slice(offset),
    );

    for (const count of [0, 1, 2, 3, 4]) {
      const source = `费用：${'\\'.repeat(count)}`;
      await reset(source, mode);
      await page.keyboard.type('$');
      await check(
        `dollar after ${count} backslashes`,
        mode,
        source + (count % 2 ? '$' : '$$'),
        source.length + 1,
      );
    }
    await reset('$x$', mode, 2);
    await page.keyboard.type('$');
    await check('skip existing closing dollar', mode, '$x$', 3);
    const prefix = '\\'.repeat(2);
    await reset(prefix, mode);
    await page.keyboard.type('$x$');
    await check('complete formula after two literal backslashes', mode, `${prefix}$x$`, 5);
    await reset('$x$ 后文', mode, 2, 6);
    await page.keyboard.type('$');
    await check('replace closing dollar and selected following text', mode, '$x$', 3);
    for (const source of ['$a$$b$', '`$` 普通文字 ', '`$$`\n\n普通文字 ']) {
      await reset(source, mode);
      const context = await page.evaluate(() => window.editorInputFixture.math());
      assert.equal(context.inside, false, `closed/code math context in ${source}`);
      assert.deepEqual(context.renderedFormulas, source === '$a$$b$' ? ['a', 'b'] : []);
      await page.keyboard.type('$');
      await check(`start a formula after ${source}`, mode, source + '$$', source.length + 1);
      await page.keyboard.type('x$');
      await check(`finish a formula after ${source}`, mode, source + '$x$', source.length + 3);
      const finished = await page.evaluate(() => window.editorInputFixture.math());
      assert.equal(finished.inside, false);
      assert.deepEqual(finished.renderedFormulas, source === '$a$$b$' ? ['a', 'b', 'x'] : ['x']);
    }
    const unfinishedCode = '```js\nconst x = \n```';
    await reset(unfinishedCode, mode, unfinishedCode.indexOf('\n```'));
    await page.keyboard.type('$');
    await check('literal dollar inside code', mode, '```js\nconst x = $\n```');
    const blink = await page
      .locator('.cm-cursorLayer')
      .evaluate((element) => element.style.animationDuration);
    assert.equal(blink, '1060ms');
  }

  const table = '| 名称 |\n| --- |\n| 旧值 |';
  for (const key of ['Enter', 'Escape']) {
    await reset(table, 'live');
    const cell = page.getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true });
    await cell.focus();
    const composing = await cell.evaluate((element, key) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      element.value = '候选文字';
      element.setSelectionRange(2, 2);
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertCompositionText',
          data: '候选文字',
          isComposing: true,
        }),
      );
      const event = new KeyboardEvent('keydown', {
        key,
        keyCode: 229,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        focused: document.activeElement === element,
        value: element.value,
        caret: [element.selectionStart, element.selectionEnd],
      };
    }, key);
    assert.deepEqual(composing, {
      prevented: false,
      focused: true,
      value: '候选文字',
      caret: [2, 2],
    });
    // Cell input is the document truth immediately; composing keys must not undo it or blur.
    assert.equal(
      await page.evaluate(() => window.editorInputFixture.state().source),
      table.replace('旧值', '候选文字'),
    );
    const completed = await cell.evaluate((element) => {
      const sameInput = element;
      element.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '最终文字' }),
      );
      element.value = '最终文字';
      element.setSelectionRange(3, 3);
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: '最终文字',
          isComposing: false,
        }),
      );
      return {
        sameNode: element.isConnected && document.activeElement === sameInput,
        value: element.value,
        caret: [element.selectionStart, element.selectionEnd],
      };
    });
    assert.deepEqual(completed, { sameNode: true, value: '最终文字', caret: [3, 3] });
    assert.equal(
      await page.evaluate(() => window.editorInputFixture.state().source),
      table.replace('旧值', '最终文字'),
    );
    await page.keyboard.press(key);
    await expect
      .poll(() => page.evaluate(() => window.editorInputFixture.state().source))
      .toBe(key === 'Enter' ? table.replace('旧值', '最终文字') : table);
    results.push({
      name: `table ${key} composing guard and normal key`,
      syntheticCompositionOnly: true,
    });
  }
  assert.deepEqual(errors, []);
  const report = { headless: true, realWindowsIME: false, errors, results };
  await mkdir('.test-data', { recursive: true });
  await writeFile('.test-data/editor-input-headless.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({ headless: true, realWindowsIME: false, checks: results.length, errors }),
  );
} finally {
  await browser?.close();
  await server.close();
}
