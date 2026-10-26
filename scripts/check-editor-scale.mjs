import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('artifacts/editor-scale');
await mkdir(output, { recursive: true });
await mkdir('.test-data/editor-scale-build', { recursive: true });
await writeFile(
  '.test-data/editor-scale-build/index.html',
  '<!doctype html><html><body><div id="root"></div><script type="module" src="../../scripts/fixtures/editor-scale.jsx"></script></body></html>',
);
await build({
  configFile: false,
  base: './',
  plugins: [react()],
  logLevel: 'error',
  build: {
    outDir: path.join(output, 'built'),
    rollupOptions: { input: path.resolve('.test-data/editor-scale-build/index.html') },
  },
});
const root = path.join(output, 'built');
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(
      root,
      `.${pathname === '/' ? '/.test-data/editor-scale-build/index.html' : pathname}`,
    );
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403).end();
      return;
    }
    const mime = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.html')
          ? 'text/html'
          : 'application/octet-stream';
    response.setHeader('Content-Type', mime);
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const report = {
  environment:
    'Headless Edge; production-built MarkdownEditor; generated text; dispatch and two animation frames, not real IME or OS key-to-paint',
  results: [],
  errors: [],
};
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.perfAudit);
  for (const bytes of [30720, 307200, 1048576]) {
    const paragraph =
      '## 学习小节\n\n这是一篇生成的文章，包含普通正文和 **加粗** 与 `code`，仅用于隔离性能测量。\n\n- 第一条记录\n- 第二条记录\n\n';
    let source = paragraph.repeat(Math.ceil(bytes / Buffer.byteLength(paragraph)));
    while (Buffer.byteLength(source) > bytes) source = source.slice(0, -1);
    for (const mode of ['live', 'source']) {
      await page.evaluate(({ source, mode }) => window.perfAudit.reset(source, mode), {
        source,
        mode,
      });
      await page.waitForTimeout(100);
      const samples = [];
      for (let i = 0; i < 3; i++)
        samples.push(await page.evaluate(() => window.perfAudit.measure()));
      const row = { actualBytes: Buffer.byteLength(source), mode, samples };
      report.results.push(row);
      console.log(JSON.stringify(row));
    }
  }
  if (report.errors.length) throw Error(report.errors.join('\n'));
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
