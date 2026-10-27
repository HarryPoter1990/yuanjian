// Real App, generated transfer responses and an in-memory clipboard; no desktop or real notes.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { fixtureGraphPlugin } from './fixture-graph-plugin.mjs';

const out = 'artifacts/transfer-ui';
await mkdir(out, { recursive: true });
const bundle = await build({
  plugins: [fixtureGraphPlugin()],
  entryPoints: ['scripts/fixtures/transfer-app.jsx'],
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
      'src/components/import-panel.css',
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
      '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>',
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
const source = (format, text) => ({
  kind: 'source',
  name: `生成.${format}`,
  source: {
    id: 'generated-source',
    path: `D:/generated-source/生成.${format}`,
    name: `生成.${format}`,
    format,
    text,
    encoding: 'utf-8',
  },
});
async function drop(page, items) {
  await page.evaluate((values) => {
    window.workflowFixture.transferItems = values;
    const data = new DataTransfer();
    data.items.add(new File(['generated'], 'generated-drop.md', { type: 'text/markdown' }));
    const body = document.querySelector('.editor-surface');
    const bounds = body.getBoundingClientRect();
    body.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: bounds.x + bounds.width / 2,
        clientY: bounds.y + bounds.height - 80,
      }),
    );
  }, items);
}
const doc = (page) => page.evaluate(() => window.workflowFixture.document());
async function dismissResult(page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
}
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function check(name, action, width = 1200) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(base);
      await page.locator('.cm-content').waitFor();
      await action(page);
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.workflowFixture.missingApi), []);
      results.push({ name, passed: true, errors });
    } catch (error) {
      results.push({ name, passed: false, errors, message: error.stack });
    } finally {
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.close();
    }
  }
  await check('csv-preview-encoding-headerless', async (page) => {
    const before = await doc(page);
    await drop(page, [source('csv', '姓名;说明\n甲;"一,二\n三"')]);
    await expect(page.getByRole('table', { name: '表格导入预览' })).toBeVisible();
    await expect(page.getByLabel('导入分隔符')).toHaveValue(';');
    assert.equal(await doc(page), before);
    await page.getByLabel('导入字符编码').selectOption('gb18030');
    await expect(page.getByRole('cell', { name: '中文,内容' })).toBeVisible();
    await page.getByLabel('首行是表头').uncheck();
    await page.getByRole('button', { name: '生成 Markdown 草稿', exact: true }).click();
    await expect.poll(() => doc(page)).toContain('| 姓名 | 说明 |');
    assert.match(await doc(page), /^\|\s*\|\s*\|\n/);
    assert.equal(await page.evaluate(() => window.workflowFixture.saved.length), 0);
  });
  await check('csv-cancel-malformed-keeps-note', async (page) => {
    const before = await doc(page);
    await drop(page, [source('csv', 'a,"unclosed')]);
    await expect(
      page.getByRole('button', { name: '生成 Markdown 草稿', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: '取消导入', exact: true }).click();
    assert.equal(await doc(page), before);
    await expect(page.getByRole('dialog')).toContainText('已取消本文件导入');
  });
  await check('html-table-draft-no-source-overwrite', async (page) => {
    await drop(page, [
      source(
        'html',
        '<h2>生成回答</h2><p>前文</p><table><tr><td>第一行</td><td><code>a|b</code></td></tr><tr><td>第二行<br>格内换行</td><td>内容</td></tr></table><p>后文</p>',
      ),
    ]);
    await dismissResult(page);
    await expect.poll(() => doc(page)).toContain('## 生成回答');
    const content = await doc(page);
    for (const text of ['前文', '第一行', 'a\\|b', '第二行<br>格内换行', '后文'])
      assert.ok(content.includes(text), text);
    assert.equal(await page.evaluate(() => window.workflowFixture.saved.length), 0);
    assert.equal(await page.locator('.markdown-table-widget textarea').count(), 6);
  });
  await check('mixed-drop-image-belongs-to-origin', async (page) => {
    await drop(page, [
      { kind: 'image', name: 'generated.png', mime: 'image/png', bytes: [1, 2, 3] },
      {
        kind: 'note',
        name: 'Gamma.md',
        note: {
          id: 'Gamma-native',
          path: 'D:/generated-workflow/Gamma.md',
          title: 'Gamma',
          content: '# Gamma\n\n原文件内容',
          hash: 'g',
          modifiedAt: 1,
        },
      },
    ]);
    await dismissResult(page);
    await expect.poll(() => doc(page)).toContain('原文件内容');
    const images = await page.evaluate(() => window.workflowFixture.attachments);
    assert.equal(images.length, 1);
    assert.ok(images[0].notePath.endsWith('/Alpha.md'));
    await page.locator('.tabs-bar [role="tab"]').filter({ hasText: 'Alpha' }).click();
    await expect.poll(() => doc(page)).toContain('assets/generated.png');
    assert.ok(!(await doc(page)).includes('原文件内容'));
  });
  await check('late-drop-does-not-insert-into-new-active', async (page) => {
    await page.evaluate(() => {
      window.workflowFixture.transferPending = true;
    });
    await drop(page, [{ kind: 'image', name: 'late.png', mime: 'image/png', bytes: [1] }]);
    await expect
      .poll(() => page.evaluate(() => Boolean(window.workflowFixture.releaseTransfer)))
      .toBe(true);
    await page.locator('.tabs-bar [role="tab"]').filter({ hasText: 'Beta' }).click();
    await page.evaluate(() => window.workflowFixture.releaseTransfer());
    await expect(page.getByRole('dialog')).toContainText('目标已切换');
    assert.equal(await page.evaluate(() => window.workflowFixture.attachments.length), 0);
    assert.ok(!(await doc(page)).includes('late.png'));
  });
  await check(
    'narrow-preview-no-window-overflow',
    async (page) => {
      await drop(page, [
        source('csv', '一,二,三,四,五,六,七,八,九,十,十一,十二\na,b,c,d,e,f,g,h,i,j,k,l'),
      ]);
      await expect(page.getByRole('table', { name: '表格导入预览' })).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const box = await page.getByRole('dialog').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 500);
    },
    500,
  );
  await check('whole-table-native-clipboard-item', async (page) => {
    await page.evaluate(() =>
      window.workflowFixture.setSource('| A | B |\n| --- | --- |\n| 值 | 数据 |\n\n尾段'),
    );
    const input = page.getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true });
    await input.click();
    await page.getByRole('button', { name: '复制整表', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.workflowFixture.formattedCopies.length))
      .toBe(1);
    const [copy] = await page.evaluate(() => window.workflowFixture.formattedCopies);
    assert.equal(copy.plain, '| A | B |\n| --- | --- |\n| 值 | 数据 |');
    assert.match(copy.html, /<table>/);
    assert.match(copy.html, /<td>数据<\/td>/);
    assert.doesNotMatch(copy.html, /<button|<textarea|复制整表/);
  });
  await check('internal-selection-physical-move', async (page) => {
    await page.evaluate(() => {
      const state = window.workflowFixture;
      state.setSource('MOVE keep TARGET');
      state.editor().dispatch({ selection: { anchor: 0, head: 4 } });
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const points = await page.evaluate(() => {
      const view = window.workflowFixture.editor();
      const start = view.coordsAtPos(2),
        end = view.coordsAtPos(view.state.doc.length);
      return {
        start: { x: start.left, y: (start.top + start.bottom) / 2 },
        end: { x: end.left, y: (end.top + end.bottom) / 2 },
      };
    });
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.end.x, points.end.y, { steps: 20 });
    await page.mouse.up();
    await expect.poll(() => doc(page)).toBe(' keep TARGETMOVE');
  });
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        results,
        nativeExplorerTested: false,
        filesystemTransport: 'generated responses; real preload tested separately',
      },
      null,
      2,
    ),
  );
}
for (const result of results)
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.message ? '\n' + result.message : ''}`,
  );
assert.ok(
  results.length === 8 && results.every((result) => result.passed),
  'Transfer UI checks failed',
);
