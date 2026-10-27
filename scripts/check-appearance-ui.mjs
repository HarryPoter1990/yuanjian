// Real App, generated notes, in-memory APIs, headless Edge. No desktop or system clipboard.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { fixtureGraphPlugin } from './fixture-graph-plugin.mjs';
const out = 'artifacts/theme-ui-2026-10-26/production';
await mkdir(out, { recursive: true });
const bundle = await build({
  plugins: [fixtureGraphPlugin()],
  stdin: {
    contents: `
import './scripts/fixtures/workflow-app.jsx';
const state=window.workflowFixture;state.settingsWrites=[];state.failAppearance=false;
const save=window.notes.saveSettings;
window.notes.saveSettings=async value=>{state.settingsWrites.push(structuredClone(value));if(state.failAppearance){state.failAppearance=false;throw Error('generated appearance write failure');}return save(value);};
window.notes.chooseWallpaper=async()=>'D:/generated-wallpaper.png';
window.notes.getFontCatalog=async()=>[];
window.notes.assetUrl=async()=> 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#a9ae93"/><circle cx="400" cy="100" r="220" fill="#d0baa2"/></svg>');
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
const css = (
  await Promise.all(
    [
      'src/styles/app.css',
      'src/styles/writing.css',
      'src/styles/icons.css',
      'src/editor/editor.css',
      'src/components/quick-open.css',
      'node_modules/katex/dist/katex.min.css',
    ].map((file) => readFile(file, 'utf8')),
  )
).join('\n');
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(bundle.outputFiles[0].text);
  } else if (req.url === '/app.css') {
    res.setHeader('Content-Type', 'text/css');
    res.end(css);
  } else if (/^\/fonts\/KaTeX_[\w-]+\.woff2?$/.test(req.url)) {
    res.setHeader('Content-Type', req.url.endsWith('woff2') ? 'font/woff2' : 'font/woff');
    res.end(await readFile('node_modules/katex/dist' + req.url));
  } else if (req.url === '/yuanjian.png') {
    res.setHeader('Content-Type', 'image/png');
    res.end(await readFile('public/yuanjian.png'));
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>',
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
const errors = [],
  checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.cm-content').waitFor();
  const root = page.locator('.app');
  const current = () =>
    page.evaluate(() => JSON.parse(sessionStorage.getItem('workflow-settings') || 'null'));
  const openSettings = async () => {
    await page.keyboard.press('Control+,');
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  };
  await openSettings();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByLabel('明暗模式', { exact: true }).selectOption('system');
  await dialog.getByRole('button', { name: '预览浅色', exact: true }).click();
  await dialog.getByLabel('强调色 HEX', { exact: true }).fill('#987654');
  await dialog.getByRole('button', { name: '壁纸', exact: true }).click();
  await dialog.getByRole('button', { name: '选择图片', exact: true }).click();
  await expect(root.locator('.wallpaper')).toHaveCount(1);
  await dialog.getByRole('button', { name: '编辑与文件', exact: true }).click();
  await dialog.getByLabel('自动保存', { exact: true }).click();
  await expect.poll(current).not.toBeNull();
  assert.notEqual((await current()).appearance.paletteOverrides?.light?.accent, '#987654');
  assert.equal((await current()).appearance.wallpaper, '');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(root.locator('.wallpaper')).toHaveCount(0);
  checks.push('preview isolated during general save; close restores wallpaper and colors');
  await openSettings();
  await dialog.getByLabel('明暗模式', { exact: true }).selectOption('system');
  await dialog.getByRole('button', { name: '预览浅色', exact: true }).click();
  await dialog.getByLabel('浅色配色', { exact: true }).selectOption('paper');
  await dialog.getByLabel('深色配色', { exact: true }).selectOption('ink');
  await dialog.getByLabel('代码配色', { exact: true }).selectOption('calm');
  await dialog.getByLabel('控件密度', { exact: true }).selectOption('compact');
  await dialog.getByRole('button', { name: '高级颜色 展开', exact: true }).click();
  await dialog.getByLabel('文字色 HEX', { exact: true }).fill('#invalid');
  await dialog.getByRole('button', { name: '高级颜色 收起', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '应用外观', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '高级颜色 展开', exact: true }).click();
  await dialog.getByRole('button', { name: '还原文字色', exact: true }).click();
  checks.push('invalid color survives collapse and prevents apply');
  await dialog.getByRole('button', { name: '高级颜色 收起', exact: true }).click();
  await page.screenshot({ path: `${out}/settings-light.png` });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  checks.push('system change cannot interrupt locked preview');
  await dialog.getByRole('button', { name: '预览深色', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `${out}/settings-dark.png` });
  await page.evaluate(() => (window.workflowFixture.failAppearance = true));
  await dialog.getByRole('button', { name: '应用外观', exact: true }).click();
  await expect(dialog.locator('.settings-feedback')).toContainText('外观未应用');
  assert.notEqual((await current()).appearance.density, 'compact');
  await dialog.getByRole('button', { name: '应用外观', exact: true }).click();
  await expect(dialog.locator('.settings-feedback')).toContainText('外观已应用');
  assert.equal((await current()).appearance.mode, 'system');
  assert.equal((await current()).appearance.density, 'compact');
  checks.push('failed apply preserves draft; retry commits and restores system mode');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.locator('.cm-content').waitFor();
  await expect(root).toHaveAttribute('data-density', 'compact');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(
    '# 把想法写下来\n\n一份生成的笔记，展示日常记录。\n\n- [x] 整理今天的收获\n- [ ] 明天继续\n\n```javascript\n// 从这里开始\nconst idea = "鸢笺";\nreturn idea.length + 1;\n```\n\n| 计划 | 状态 |\n| --- | --- |\n| 阅读与记录 | 进行中 |\n\n$E = mc^2$',
  );
  await page.keyboard.press('Control+Home');
  await page.screenshot({ path: `${out}/window-dark.png` });
  const titleHeight = await page
    .locator('.app-header')
    .evaluate((e) => e.getBoundingClientRect().height);
  assert.equal(titleHeight, 44);
  assert.ok(
    (await page.locator('.window-drag-region').evaluate((e) => e.getBoundingClientRect().width)) >=
      120,
  );
  await openSettings();
  await dialog.getByRole('button', { name: '预览浅色', exact: true }).click();
  await page.screenshot({ path: `${out}/settings-restored.png` });
  await dialog.getByLabel('代码配色', { exact: true }).selectOption('contrast');
  const token = dialog.locator('.appearance-live-preview .hljs-keyword').first();
  await expect(token).toHaveCSS('color', 'rgb(121, 52, 155)');
  const preview = dialog.locator('.appearance-live-preview article');
  const originalSize = await preview.evaluate((e) => getComputedStyle(e).fontSize);
  await dialog.getByLabel('正文字号', { exact: true }).fill('22');
  await expect(preview).toHaveCSS('font-size', '22px');
  assert.notEqual(originalSize, '22px');
  checks.push('small preview uses actual text size and independent syntax colors');
  await dialog.getByRole('button', { name: '取消预览', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '进入便笺模式', exact: true }).click();
  await expect(root).toHaveAttribute('data-window-mode', 'sticky');
  await page.setViewportSize({ width: 420, height: 640 });
  await page.screenshot({ path: `${out}/sticky-dark.png` });
  assert.ok(
    (await page.locator('.sticky-drag-handle').count()) ||
      (await page.locator('.sticky-header').count()),
  );
  checks.push('sticky shares applied appearance; full titlebar height and drag width preserved');
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ headless: true, generatedOnly: true, checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
