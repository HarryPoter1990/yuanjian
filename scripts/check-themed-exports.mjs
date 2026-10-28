// Exercise the real App export action, real standalone exporter, and screen/print CSS.
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { measure } from './lib/browser-contrast.mjs';
const output = process.env.EXPORT_CHECK_OUT || 'artifacts/residuals-2026-10-28/exports';
const palettes = (
  process.env.EXPORT_CHECK_PALETTES || 'neutral,ink,moss,paper,slate,amber,rose,iris'
).split(',');
await mkdir(output, { recursive: true });
await mkdir('.test-data/themed-export-check', { recursive: true });
const helper = path.resolve('.test-data/themed-export-check/export.cjs');
await build({
  stdin: {
    contents: `
import {NoteStore} from './electron/storage/store';
import {ExportManager} from './electron/resources/export';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
export async function standalone(request,target){
 const directory=await mkdtemp(path.resolve('.test-data/themed-export-check/data-'));
 const store=new NoteStore(directory);await store.initialize();
 try {return await new ExportManager(store,{chooseSave:async()=>target,buildDirectory:path.resolve('dist'),assetData:async()=>{throw Error('Unexpected resource')},renderPdf:async()=>{throw Error('HTML pass only')}}).exportDocument({...request,notePath:null});}
 finally{await store.dispose()}
}`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: helper,
  format: 'cjs',
  bundle: true,
  platform: 'node',
});
const { standalone } = createRequire(import.meta.url)(helper);
const entry = output + '/input.html';
await writeFile(
  entry,
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><base href="/"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/note-syntax-app.jsx"></script></body></html>',
);
const server = await createServer({
  server: {
    host: '127.0.0.1',
    port: 0,
    watch: { ignored: ['**/artifacts/**', '**/.test-data/**'] },
  },
  optimizeDeps: { entries: [path.resolve(entry)] },
});
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { cases: [], errors: [] };
try {
  const port = server.httpServer.address().port;
  for (const palette of palettes)
    for (const mode of ['light', 'dark'])
      for (const useTheme of [false, true]) {
        const item = { palette, mode, useTheme, checks: [] },
          page = await browser.newPage({ viewport: { width: 1200, height: 960 } });
        page.on('pageerror', (error) => report.errors.push(error.message));
        try {
          await page.goto(
            `http://127.0.0.1:${port}/${entry}?visual=inline-code&mode=${mode}&palette=${palette}&code-block=true`,
          );
          await page.waitForFunction(
            () =>
              window.noteIntegration?.view() && document.querySelector('.prototype-inline-code'),
          );
          await page.getByRole('button', { name: '导出', exact: true }).click();
          await page.getByLabel('导出沿用当前主题').setChecked(useTheme);
          await expect(page.locator('.reading-preview code').first()).toHaveText(
            'SELECT / WHERE / ORDER BY',
          );
          item.preview = await measure(
            page,
            '.reading-preview,.reading-preview :not(pre)>code,.reading-preview .code-line-content',
          );
          await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
          await expect
            .poll(() => page.evaluate(() => window.noteIntegration.exports.length))
            .toBe(1);
          const request = await page.evaluate(() => window.noteIntegration.exports[0]);
          const target = path.resolve(`${output}/${palette}-${mode}-${useTheme}.html`);
          await standalone(request, target);
          const exported = await browser.newPage();
          try {
            await exported.route('**/*', (route) =>
              /^https?:/.test(route.request().url()) ? route.abort() : route.continue(),
            );
            await exported.goto(new URL('file:///' + target.replaceAll('\\', '/')).href);
            await exported.evaluate(() => document.fonts.ready);
            for (const media of ['screen', 'print']) {
              await exported.emulateMedia({ media });
              item.checks.push({
                media,
                detail: await measure(
                  exported,
                  'article.markdown-rendered,article.markdown-rendered :not(pre)>code,article.markdown-rendered .code-line-content',
                ),
              });
            }
            if (palette === 'neutral' && mode === 'dark' && useTheme)
              await exported.screenshot({
                path: `${output}/dark-themed-print.png`,
                fullPage: true,
              });
          } finally {
            await exported.close();
          }
          item.passed =
            item.preview.length >= 8 &&
            item.preview.every((text) => text.visible && text.contrast >= 4.5) &&
            item.checks.every(
              (check) =>
                check.detail.length >= 8 &&
                check.detail.every((text) => text.visible && text.contrast >= 4.5),
            );
        } catch (error) {
          item.passed = false;
          item.error = error.message;
        }
        report.cases.push(item);
        await page.close();
      }
} finally {
  report.passed =
    report.cases.length === palettes.length * 4 &&
    report.cases.every((item) => item.passed) &&
    report.errors.length === 0;
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        cases: report.cases.map(({ palette, mode, useTheme, passed, error, checks }) => ({
          palette,
          mode,
          useTheme,
          passed,
          error,
          minContrast: Math.min(
            ...checks.flatMap((check) => check.detail.map((text) => text.contrast)),
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
assert.ok(report.passed, 'Standalone theme export has unreadable content');
