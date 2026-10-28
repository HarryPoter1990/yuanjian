import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = process.env.INLINE_CHECK_OUT || 'artifacts/inline-code-2026-10-28/matrix';
const palettes = (
  process.env.INLINE_CHECK_PALETTES || 'neutral,ink,moss,paper,slate,amber,rose,iris'
).split(',');
await mkdir(output, { recursive: true });
const entry = output + '/inline.html';
await writeFile(
  entry,
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><base href="/"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/note-syntax-app.jsx"></script></body></html>',
);
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { entries: [path.resolve(entry)] },
});
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = {
  cases: [],
  errors: [],
  externalRequests: [],
  source: 'Generated SQL list and user-provided task line; real App, headless Edge',
};
async function measure(page, selector) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d');
      const rgba = (value) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const composite = (over, under) => {
        const a = over[3] / 255;
        return over
          .slice(0, 3)
          .map((value, index) => value * a + under[index] * (1 - a))
          .concat(255);
      };
      let background = [255, 255, 255, 255];
      const chain = [];
      for (let parent = node; parent; parent = parent.parentElement) chain.unshift(parent);
      for (const element of chain)
        background = composite(rgba(getComputedStyle(element).backgroundColor), background);
      const luminance = (value) =>
        value
          .slice(0, 3)
          .map((channel) => {
            const v = channel / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const contrast = (color) => {
        const a = luminance(composite(rgba(color), background)),
          b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT),
        colors = [];
      for (let text = walker.nextNode(); text; text = walker.nextNode())
        if (text.textContent.trim()) colors.push(getComputedStyle(text.parentElement).color);
      const style = getComputedStyle(node),
        rect = node.getBoundingClientRect();
      return {
        text: node.textContent,
        color: style.color,
        background: style.backgroundColor,
        contrast: Math.min(...colors.map(contrast)),
        visible: rect.width > 0 && rect.height > 0,
      };
    }),
  );
}
async function mode(page, label) {
  await page.getByRole('button', { name: '切换编辑模式', exact: true }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}
try {
  const port = server.httpServer.address().port,
    base = `http://127.0.0.1:${port}`;
  for (const palette of palettes)
    for (const appearance of ['light', 'dark'])
      for (const wallpaper of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        page.on('pageerror', (error) => report.errors.push(error.message));
        await page.route('**/*', (route) => {
          const url = route.request().url();
          if (/^https?:/.test(url) && !url.startsWith(base)) {
            report.externalRequests.push(url);
            return route.abort();
          }
          return route.continue();
        });
        const item = { palette, appearance, wallpaper, checks: [] };
        try {
          await page.goto(
            `${base}/${entry}?visual=inline-code&mode=${appearance}&palette=${palette}&wallpaper=${wallpaper}`,
          );
          await page.waitForFunction(
            () =>
              window.noteIntegration?.view() && document.querySelector('.prototype-inline-code'),
          );
          await page.evaluate(() => document.fonts.ready);
          if (wallpaper) await expect(page.locator('.wallpaper')).toHaveCount(1);
          const source = await page.evaluate(() => window.noteIntegration.state().source);
          assert.ok(source.includes('- ☐  设计 `users`（可先简化）、`tasks` 表，绘制简单 ER 图。'));
          item.checks.push({
            stage: 'live-inactive',
            detail: await measure(page, '.prototype-inline-code'),
          });
          if (palette === 'neutral' || (palette === 'iris' && appearance === 'dark'))
            await page.screenshot({ path: `${output}/${palette}-${appearance}-${wallpaper}.png` });
          await page
            .locator('.prototype-inline-code')
            .filter({ hasText: /^users$/ })
            .click();
          item.checks.push({
            stage: 'live-editing',
            detail: await measure(page, '.prototype-inline-code'),
          });
          const viewState = await page.evaluate(() => window.noteIntegration.state());
          assert.equal(viewState.source, source);
          assert.ok(
            viewState.head >= source.indexOf('`users`') &&
              viewState.head <= source.indexOf('`users`') + 7,
          );
          await page.keyboard.insertText('_new');
          assert.equal(
            await page.evaluate(() => window.noteIntegration.state().source),
            source.slice(0, viewState.head) + '_new' + source.slice(viewState.head),
          );
          await page.keyboard.press('Control+z');
          assert.equal(await page.evaluate(() => window.noteIntegration.state().source), source);
          await page.evaluate(() => {
            const view = window.noteIntegration.view();
            view.dispatch({
              selection: { anchor: view.state.doc.toString().indexOf('待核对的注释') + 2 },
            });
          });
          item.checks.push({
            stage: 'comment-editing',
            detail: await measure(page, '.prototype-comment'),
          });
          await mode(page, '阅读');
          await expect(page.locator('.document-preview code').first()).toHaveText(
            'SELECT / WHERE / ORDER BY',
          );
          item.checks.push({
            stage: 'reading',
            detail: await measure(page, '.document-preview :not(pre)>code'),
          });
          await mode(page, '源码对照');
          item.checks.push({
            stage: 'split',
            detail: await measure(page, '.document-preview :not(pre)>code'),
          });
          assert.equal(await page.evaluate(() => window.noteIntegration.state().source), source);
          assert.deepEqual(await page.evaluate(() => window.noteIntegration.unknown), []);
          item.passed = item.checks.every(
            (check) =>
              check.detail.length >= (check.stage === 'comment-editing' ? 1 : 7) &&
              check.detail.every((code) => code.visible && code.contrast >= 4.5),
          );
        } catch (error) {
          item.passed = false;
          item.error = error.message;
          await page.screenshot({
            path: `${output}/failure-${palette}-${appearance}-${wallpaper}.png`,
          });
        }
        report.cases.push(item);
        await page.close();
      }
} finally {
  report.passed =
    report.cases.length === palettes.length * 4 &&
    report.cases.every((item) => item.passed) &&
    report.errors.length === 0 &&
    report.externalRequests.length === 0;
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        cases: report.cases.map(({ palette, appearance, wallpaper, passed, error, checks }) => ({
          palette,
          appearance,
          wallpaper,
          passed,
          error,
          minContrast: Math.min(
            ...checks.flatMap((check) => check.detail.map((code) => code.contrast)),
          ),
        })),
        errors: report.errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await server.close();
}
assert.ok(report.passed, 'Inline code is unreadable or content is missing');
