// Actual App, CodeMirror and rendering. All documents, APIs, clipboard and settings are generated/in-memory.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { fixtureGraphPlugin } from './fixture-graph-plugin.mjs';
const out = 'artifacts/writing-ui-2026-10-27';
await mkdir(out, { recursive: true });
const bundle = await build({
  plugins: [fixtureGraphPlugin()],
  stdin: {
    contents: `
import './scripts/fixtures/workflow-app.jsx';
import {EditorView} from '@codemirror/view';
window.writingFixture={view:()=>EditorView.findFromDOM(document.querySelector('.cm-content')),replace:content=>{const view=window.writingFixture.view();view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content},selection:{anchor:0}});}};
`,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
});
const files = [
  'src/styles/app.css',
  'src/styles/icons.css',
  'src/editor/editor.css',
  'src/components/quick-open.css',
  'src/styles/writing.css',
  'node_modules/katex/dist/katex.min.css',
];
let css = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
const fontPackages = {
  sans: '@fontsource-variable/noto-sans-sc',
  inter: '@fontsource-variable/inter',
  code: '@fontsource/jetbrains-mono',
};
for (const [id, pkg] of Object.entries(fontPackages))
  css +=
    '\n' +
    (await readFile(`node_modules/${pkg}/index.css`, 'utf8')).replaceAll(
      './files/',
      `/font/${id}/`,
    );
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle.outputFiles[0].text);
    } else if (req.url === '/app.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css);
    } else if (/^\/font\/(sans|inter|code)\/[\w.-]+\.(woff2?|ttf)$/.test(req.url)) {
      const [, , id, name] = req.url.split('/');
      res.setHeader('Content-Type', 'font/woff2');
      res.end(await readFile(`node_modules/${fontPackages[id]}/files/${name}`));
    } else if (/^\/fonts\/KaTeX_[\w-]+\.(woff2?|ttf)$/.test(req.url)) {
      res.setHeader('Content-Type', 'font/woff2');
      res.end(await readFile('node_modules/katex/dist' + req.url));
    } else if (req.url === '/yuanjian.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(await readFile('public/yuanjian.png'));
    } else if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>',
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) {
  await writeFile(`${out}/url.txt`, url);
  console.log(url);
  await new Promise(() => {});
} else {
  let browser;
  const errors = [],
    checks = [];
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('.cm-content').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const sample =
      '# 先理解，再记住\n\n读完一章以后，我先关上书，写下自己的理解。记不起来的地方，再回到原文寻找依据。\n\n## 今天的复习\n\n- [x] 整理课堂笔记\n- [ ] 补充自己的例子\n\n> 能用自己的话重新表达，才算真正理解。\n\n## 一个小例子\n\n```java\nint total = 10;\ndouble probability = 0.5;\n```\n\n| 知识点 | 掌握情况 |\n| --- | --- |\n| 条件概率 | 还需练习 |\n';
    await page.evaluate((content) => window.writingFixture.replace(content), sample);
    const root = page.locator('.app');
    await expect(root).toHaveCSS('background-color', 'rgb(250, 250, 250)');
    assert.equal(
      await page.locator('.app-header').evaluate((e) => e.getBoundingClientRect().height),
      44,
    );
    assert.ok(
      (await page
        .locator('.window-drag-region')
        .evaluate((e) => e.getBoundingClientRect().width)) >= 120,
    );
    await expect(page.getByRole('button', { name: '打开格式菜单', exact: true })).toBeVisible();
    await expect(page.locator('.editor-toolbar')).toHaveCount(0);
    await page.screenshot({ path: `${out}/workspace-light.png` });
    await page.evaluate(() => {
      const view = window.writingFixture.view();
      const from = view.state.doc.toString().indexOf('读完一章');
      view.dispatch({ selection: { anchor: from, head: from + 4 } });
      window.writingFixture.original = view;
    });
    await page.getByRole('button', { name: '打开格式菜单', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '编辑格式', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '粗体', exact: true }).click();
    assert.ok(
      (await page.evaluate(() => window.workflowFixture.document())).includes('**读完一章**'),
    );
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.workflowFixture.document()), sample);
    checks.push('Aa operates on the real selection and undo; toolbar is absent until opened');
    await page.getByRole('button', { name: '打开格式菜单', exact: true }).click();
    await page.getByRole('button', { name: '标题', exact: true }).click();
    await expect(page.getByRole('menu', { name: '标题级别' }).getByRole('menuitem')).toHaveCount(7);
    await page.getByRole('menuitem', { name: 'H3 三级标题', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.workflowFixture.document()), sample);
    checks.push('all H1–H6 and body choices remain usable inside Aa');
    const beforeSettings = await page.evaluate(() => sessionStorage.getItem('workflow-settings'));
    await page.getByRole('button', { name: '进入专注写作', exact: true }).click();
    await expect(root).toHaveAttribute('data-writing-focus', 'true');
    await expect(page.locator('.left-sidebar')).not.toBeVisible();
    await expect(page.locator('.right-sidebar')).not.toBeVisible();
    const savedBefore = await page.evaluate(() => window.workflowFixture.saved.length);
    await page.getByRole('button', { name: '保存当前笔记', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.workflowFixture.saved.length))
      .toBe(savedBefore + 1);
    await page.screenshot({ path: `${out}/focus.png` });
    await page.getByRole('button', { name: '退出专注', exact: true }).click();
    await expect(root).toHaveAttribute('data-writing-focus', 'false');
    assert.equal(
      await page.evaluate(() => window.writingFixture.view() === window.writingFixture.original),
      true,
    );
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem('workflow-settings')),
      beforeSettings,
    );
    checks.push('focus restores the original layout and EditorView without writing preferences');
    async function mode(name) {
      await page.getByRole('button', { name: '切换编辑模式', exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    }
    await mode('源码对照');
    await expect(root).toHaveAttribute('data-document-view', 'split');
    await expect(page.locator('.document-preview')).toContainText('先理解，再记住');
    await expect(page.locator('.markdown-editor')).toHaveClass(/is-source/);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n分屏中新写的内容。');
    await expect(page.locator('.document-preview')).toContainText('分屏中新写的内容。');
    await page.screenshot({ path: `${out}/split.png` });
    await page.setViewportSize({ width: 600, height: 800 });
    await page
      .locator('.split-controls')
      .getByRole('button', { name: '阅读预览', exact: true })
      .click();
    await expect(page.locator('.writing-preview-pane')).toBeVisible();
    await expect(page.locator('.writing-editor-host')).not.toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}/narrow-split.png` });
    await page.getByRole('button', { name: '返回即时排版', exact: true }).click();
    await expect(page.locator('.markdown-editor')).toHaveClass(/is-live/);
    assert.equal(
      await page.evaluate(() => window.writingFixture.view() === window.writingFixture.original),
      true,
    );
    checks.push(
      'source comparison renders edits, adapts to a narrow window, and keeps the same editor',
    );
    await page.setViewportSize({ width: 1440, height: 960 });
    await mode('阅读');
    await expect(page.locator('.document-preview')).toContainText('分屏中新写的内容。');
    await page.keyboard.press('Control+f');
    await expect(page.locator('.cm-search')).toBeVisible();
    await expect(root).toHaveAttribute('data-document-view', 'edit');
    await page.keyboard.press('Escape');
    checks.push('read-only view can return to editing through the existing find shortcut');
    const long =
      '# 阅读起点\n\n' +
      '复习不是把原文再抄一遍，而是找出自己还不理解的地方。\n\n'.repeat(100) +
      '## 阅读目标\n\n继续写下自己的解释。\n\n' +
      '补充说明。\n\n'.repeat(30);
    await page.evaluate((content) => window.writingFixture.replace(content), long);
    await mode('阅读');
    await expect(page.locator('.document-preview h2')).toHaveText('阅读目标');
    await page
      .locator('#right-outline')
      .getByRole('button', { name: '阅读目标', exact: true })
      .click();
    await expect
      .poll(() => page.locator('.writing-preview-pane').evaluate((e) => e.scrollTop))
      .toBeGreaterThan(1000);
    const readingTop = await page.locator('.writing-preview-pane').evaluate((e) => e.scrollTop);
    const offset = await page
      .locator('.document-preview h2')
      .evaluate(
        (e) =>
          e.getBoundingClientRect().top -
          e.closest('.writing-preview-pane').getBoundingClientRect().top,
      );
    assert.ok(Math.abs(offset - 24) < 3, 'outline must move visible reading pane');
    await page.getByRole('tab', { name: 'Beta', exact: true }).click();
    await expect(page.locator('.document-preview')).toContainText('Beta 第一段');
    await page.locator('.tabs-bar [role="tab"][title="D:/generated-workflow/Alpha.md"]').click();
    await expect(page.locator('.document-preview h2')).toHaveText('阅读目标');
    await expect
      .poll(() => page.locator('.writing-preview-pane').evaluate((e) => e.scrollTop))
      .toBeCloseTo(readingTop, 0);
    await page.locator('.left-sidebar input, .sidebar-search-trigger').first().focus();
    await page.keyboard.press('F6');
    await expect(page.locator('.document-preview')).toBeFocused();
    // Enter through the menu as well as Ctrl+F: commands must never target a hidden editor.
    await page.getByRole('button', { name: '笔记操作菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '查找与替换', exact: true }).click();
    await expect(root).toHaveAttribute('data-document-view', 'edit');
    await expect(page.getByRole('textbox', { name: '替换为', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate((content) => window.writingFixture.replace(content), sample);
    checks.push(
      'reading outline jumps visibly, tab positions restore, and menu replace reveals the editor',
    );
    let releaseImage;
    const imageGate = new Promise((resolve) => {
      releaseImage = resolve;
    });
    await page.route('**/generated-delayed.svg', async (route) => {
      await imageGate;
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#ccc"/></svg>',
      });
    });
    await page.evaluate(() => {
      window.notes.assetUrl = async () => `${location.origin}/generated-delayed.svg`;
    });
    await page.evaluate(
      (content) => window.writingFixture.replace(content),
      '# 加载测试\n\n![生成图片](generated-delayed.svg)\n\n```mermaid\ngraph TD; A[阅读] --> B[理解]\n```\n\n' +
        long +
        '\n键盘注释示例[^阅读]\n\n[^阅读]: 延伸解释。',
    );
    await mode('阅读');
    await expect(page.locator('.document-preview h2')).toHaveText('阅读目标');
    await page.locator('.document-preview img').evaluate((image) => {
      image.loading = 'eager';
    });
    await page
      .locator('#right-outline')
      .getByRole('button', { name: '阅读目标', exact: true })
      .click();
    assert.equal(await page.locator('.document-preview img').evaluate((e) => e.complete), false);
    releaseImage();
    await expect
      .poll(() => page.locator('.document-preview img').evaluate((e) => e.naturalHeight))
      .toBe(900);
    await expect(page.locator('.document-preview [data-mermaid] svg')).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.document-preview h2')
          .evaluate((e) =>
            Math.abs(
              e.getBoundingClientRect().top -
                e.closest('.writing-preview-pane').getBoundingClientRect().top -
                24,
            ),
          ),
      )
      .toBeLessThan(3);
    await page.locator('.writing-preview-pane').hover();
    await page.mouse.wheel(0, -500);
    await expect
      .poll(() =>
        page
          .locator('.document-preview h2')
          .evaluate(
            (e) =>
              e.getBoundingClientRect().top -
              e.closest('.writing-preview-pane').getBoundingClientRect().top,
          ),
      )
      .toBeGreaterThan(200);
    await page.locator('.document-preview [data-mermaid]').evaluate((e) => {
      e.style.height = '700px';
    });
    await expect
      .poll(() =>
        page
          .locator('.document-preview h2')
          .evaluate(
            (e) =>
              e.getBoundingClientRect().top -
              e.closest('.writing-preview-pane').getBoundingClientRect().top,
          ),
      )
      .toBeGreaterThan(200);
    checks.push(
      'delayed image and real Mermaid hydration preserve reading target; user scrolling cancels correction',
    );
    await page
      .locator('#right-outline')
      .getByRole('button', { name: '阅读目标', exact: true })
      .click();
    await page.locator('.document-preview .footnote-ref a').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.document-preview .footnotes')).toBeInViewport();
    await page.locator('.document-preview [data-mermaid]').evaluate((e) => {
      e.style.height = '1000px';
    });
    await expect
      .poll(() =>
        page
          .locator('.document-preview h2')
          .evaluate(
            (e) =>
              e.getBoundingClientRect().top -
              e.closest('.writing-preview-pane').getBoundingClientRect().top,
          ),
      )
      .toBeLessThan(-300);
    checks.push('keyboard footnote navigation supersedes the previous layout target after reflow');
    await mode('即时排版');
    await page.evaluate(() => {
      window.notes.assetUrl = async () => '';
    });
    await page.unroute('**/generated-delayed.svg');
    await page.evaluate((content) => window.writingFixture.replace(content), sample);
    await page.getByRole('tab', { name: '最近', exact: true }).click();
    await expect(page.locator('.recent-note-list')).toContainText('Alpha');
    await page.getByRole('button', { name: '更多导航', exact: true }).click();
    await page.getByRole('menuitem', { name: '标签', exact: true }).click();
    await expect(page.getByRole('tab', { name: '标签', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    checks.push('recently modified files and secondary navigation remain reachable');
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await dialog.waitFor();
    await dialog.getByLabel('明暗模式', { exact: true }).selectOption('dark');
    await dialog.getByRole('button', { name: '应用外观', exact: true }).click();
    await expect(dialog.locator('.settings-feedback')).toContainText('外观已应用');
    await page.screenshot({ path: `${out}/settings-dark.png` });
    await page.keyboard.press('Escape');
    await expect(root).toHaveCSS('background-color', 'rgb(35, 35, 35)');
    await page.screenshot({ path: `${out}/workspace-dark.png` });
    await page.getByRole('button', { name: '进入便笺模式', exact: true }).click();
    await page.setViewportSize({ width: 420, height: 640 });
    await expect(root).toHaveAttribute('data-window-mode', 'sticky');
    assert.equal(
      await page
        .locator('.sticky-drag-handle')
        .evaluate((e) => getComputedStyle(e).getPropertyValue('-webkit-app-region')),
      'drag',
    );
    await page.screenshot({ path: `${out}/sticky-dark.png` });
    checks.push(
      'neutral appearance applies through settings and is shared by the draggable sticky window',
    );
    assert.deepEqual(errors, []);
    await writeFile(
      `${out}/report.json`,
      JSON.stringify({ headless: true, generatedOnly: true, checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ checks, errors }));
  } catch (error) {
    await writeFile(
      `${out}/failure.json`,
      JSON.stringify({ checks, errors, error: String(error.stack) }, null, 2),
    );
    throw error;
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
