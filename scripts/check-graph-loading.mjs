import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
// Real production chunks, synthetic documents/API, headless Edge. No desktop control.
const out = path.resolve('artifacts/graph-loading');
await mkdir(out, { recursive: true });
const files = await readdir('dist/assets');
const graphFile = files.find((x) => /^yuanjian-graph-(?!engine).+\.js$/.test(x));
const engineFile = files.find((x) => /^yuanjian-graph-engine-.+\.mjs$/.test(x));
assert.ok(graphFile);
assert.ok(engineFile);
const graphSource = await readFile(path.join('dist/assets', graphFile), 'utf8');
const engineSource = await readFile(path.join('dist/assets', engineFile), 'utf8');
assert.ok(
  !/\bimport\s*(?:\(|[{*'"])/.test(engineSource),
  'isolated upstream ESM must have no runtime imports',
);
let fixture = await readFile('scripts/fixtures/audit-app.jsx', 'utf8');
fixture = fixture.slice(fixture.indexOf('// All notes'));
fixture = fixture.slice(0, fixture.indexOf('createRoot(document.getElementById'));
fixture = fixture
  .replace(/let source = .*;/, "let source = '# 生成笔记\\n\\n不丢失的原文。';")
  .replace(
    'const settings = structuredClone(defaultSettings);',
    'const settings=structuredClone(defaultSettings);settings.graph.local=false;settings.graph.tags=false;',
  );
fixture = fixture.replace(
  "EditorView.findFromDOM(document.querySelector('.cm-content')).state.doc.toString()",
  "document.querySelector('.cm-content')?.textContent",
);
fixture = fixture.replace(
  'getIndex: async () => [],',
  `getIndex:async()=>['A','B'].map(x=>({path:'D:/generated-audit/'+x+'.md',title:x,tags:[],links:[],headings:[],modifiedAt:1})),`,
);
const init = (
  await build({
    stdin: {
      contents: "import {defaultSettings} from './src/shared/defaults';\n" + fixture,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
  })
).outputFiles[0].text;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const target = path.resolve(
      'dist',
      '.' + (url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!target.startsWith(path.resolve('dist') + path.sep)) throw Error('scope');
    const ext = path.extname(target);
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
      }[ext] || 'application/octet-stream',
    );
    res.end(await readFile(target));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const results = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const abort of ['none', 'graph', 'engine']) {
    const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await context.addInitScript({ content: init });
    const page = await context.newPage();
    const requests = [],
      errors = [],
      external = [];
    let failed = false;
    page.on('pageerror', (e) => errors.push(e.message));
    await context.route('**/*', async (route) => {
      const u = route.request().url();
      if (!u.startsWith(base)) {
        external.push(u);
        await route.abort();
        return;
      }
      const kind = u.includes(graphFile) ? 'graph' : u.includes(engineFile) ? 'engine' : null;
      if (kind) {
        requests.push({ kind, url: u });
        if (kind === abort && !failed) {
          failed = true;
          await new Promise((r) => setTimeout(r, 150));
          await route.abort('failed');
          return;
        }
      }
      await route.continue();
    });
    try {
      await page.goto(base);
      await page.locator('.cm-content').waitFor();
      assert.equal(requests.length, 0, 'startup must not request graph UI/engine');
      await page.getByRole('button', { name: '关系图谱', exact: true }).click();
      if (abort !== 'none') {
        await expect(page.getByRole('alert')).toContainText('图谱暂时未能打开');
        await page.getByRole('button', { name: '重试加载', exact: true }).click();
      }
      await expect(page.locator('.graph-legend')).toContainText('2 个节点', { timeout: 15000 });
      await expect(page.locator('.graph-canvas canvas').first()).toBeVisible();
      assert.equal(errors.length, 0);
      const count = requests.length;
      await page.getByRole('tab').filter({ hasText: '自建交互验收' }).click();
      await expect(page.locator('.cm-content')).toContainText('不丢失的原文');
      await page.getByRole('button', { name: '关系图谱', exact: true }).click();
      await expect(page.locator('.graph-legend')).toContainText('2 个节点');
      assert.equal(requests.length, count, 'successful modules reused');
      assert.equal(await page.locator('#root > .app').count(), 1);
      if (abort !== 'none') {
        const failedRequests = requests.filter((x) => x.kind === abort);
        assert.equal(failedRequests.length, 2);
        assert.ok(failedRequests[1].url.includes('retry=1'));
        assert.equal(
          requests.filter((x) => x.kind !== abort).length,
          1,
          'successfully loaded peer must be reused',
        );
      }
      assert.deepEqual(errors, [], 'graph return/reopen must not cause runtime errors');
      assert.deepEqual(external, [], 'installed graph resources must work without external requests');
      results.push({ abort, passed: true, requests, errors, external });
    } catch (e) {
      results.push({
        abort,
        passed: false,
        message: e.stack,
        requests,
        errors,
        external,
        text: await page.locator('body').innerText(),
      });
    } finally {
      await page.screenshot({ path: path.join(out, abort + '.png') });
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await writeFile(
    path.join(out, 'results.json'),
    JSON.stringify(
      {
        realBuilt: true,
        headless: true,
        inMemoryDesktop: true,
        graphFile,
        engineFile,
        graphImports: graphSource.slice(0, 800),
        engineBytes: Buffer.byteLength(engineSource),
        results,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results, null, 2));
if (results.some((x) => !x.passed)) process.exitCode = 1;
