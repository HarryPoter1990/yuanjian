// Run with `node scripts/check-caret-blink.mjs`. Only launches headless Edge with an isolated editor.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({
  stdin: {
    contents: `
      import {createRef} from 'react';
      import {createRoot} from 'react-dom/client';
      import {getDrawSelectionConfig} from '@codemirror/view';
      import {MarkdownEditor} from './src/editor/MarkdownEditor';
      import {defaultSettings} from './src/shared/defaults';
      const reference = createRef();
      window.notes = {assetUrl: async () => ''};
      window.caretFixture = {
        view: () => reference.current.getView(),
        config: () => getDrawSelectionConfig(reference.current.getView().state),
      };
      createRoot(document.getElementById('root')).render(
        <div className="app" data-theme="light" style={{height:'100vh'}}>
          <main className="editor-surface" style={{height:'100%',width:'100%'}}>
            <MarkdownEditor ref={reference} value="光标验收，保持单个插入光标。" mode="live" settings={defaultSettings} onChange={()=>{}} />
          </main>
        </div>
      );
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
});
const css = (
  await Promise.all([
    readFile('src/editor/editor.css', 'utf8'),
    readFile('src/styles/app.css', 'utf8'),
  ])
).join('\n');
const server = createServer((request, response) => {
  const script = request.url === '/fixture.js';
  const style = request.url === '/fixture.css';
  response.writeHead(200, {
    'Content-Type': script ? 'text/javascript' : style ? 'text/css' : 'text/html',
  });
  response.end(
    script
      ? bundle.outputFiles[0].text
      : style
        ? css
        : '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const output = path.resolve('artifacts/caret-blink');
const results = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  // Check reduce first so the previous 0.01ms !important regression fails explicitly.
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const context = await browser.newContext({
      viewport: { width: 900, height: 600 },
      reducedMotion,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.locator('.cm-content').focus();
    await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
    const measured = await page.evaluate(async () => {
      const view = window.caretFixture.view();
      const layer = view.dom.querySelector('.cm-cursorLayer');
      const style = getComputedStyle(layer);
      const metadata = {
        configuredCycle: window.caretFixture.config().cursorBlinkRate,
        effectiveCycle: Number.parseFloat(style.animationDuration) * 1000,
        animationName: style.animationName,
        iterationCount: style.animationIterationCount,
        timingFunction: style.animationTimingFunction,
        nativeCaret: getComputedStyle(view.contentDOM).caretColor,
        lineCaret: getComputedStyle(view.dom.querySelector('.cm-line')).caretColor,
        cursorLayers: view.dom.querySelectorAll('.cm-cursorLayer').length,
        cursors: view.dom.querySelectorAll('.cm-cursor').length,
      };
      let attributeChanges = 0;
      const observer = new MutationObserver((records) => {
        attributeChanges += records.length;
      });
      observer.observe(layer, { attributes: true });
      const samples = [];
      let start;
      await new Promise((resolve) => {
        const frame = (time) => {
          start ??= time;
          samples.push({ time: time - start, opacity: Number(getComputedStyle(layer).opacity) });
          if (time - start >= 3400) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      observer.disconnect();
      const transitions = samples.filter(
        (sample, index) => index && sample.opacity !== samples[index - 1].opacity,
      );
      const phases = transitions
        .slice(1)
        .map((sample, index) => sample.time - transitions[index].time);
      return {
        metadata,
        phases,
        transitions: transitions.length,
        attributeChanges,
        sameLayer: layer === view.dom.querySelector('.cm-cursorLayer'),
        focused: view.hasFocus,
      };
    });
    const record = { reducedMotion, ...measured, errors };
    results.push(record);
    const detail = JSON.stringify(record);
    assert.equal(
      measured.metadata.effectiveCycle,
      1060,
      `Caret full cycle must stay 1060ms: ${detail}`,
    );
    assert.equal(measured.metadata.configuredCycle, 1060, detail);
    assert.equal(measured.metadata.iterationCount, 'infinite', detail);
    assert.equal(measured.metadata.timingFunction, 'steps(1)', detail);
    assert.equal(measured.metadata.nativeCaret, 'rgba(0, 0, 0, 0)', detail);
    assert.equal(measured.metadata.lineCaret, 'rgba(0, 0, 0, 0)', detail);
    assert.equal(measured.metadata.cursorLayers, 1, detail);
    assert.equal(measured.metadata.cursors, 1, detail);
    assert.ok(measured.phases.length >= 4, `Expected repeated visible/hidden phases: ${detail}`);
    assert.ok(
      measured.phases.every((phase) => Math.abs(phase - 530) <= 60),
      `Caret phases must be about 530ms: ${detail}`,
    );
    assert.equal(measured.attributeChanges, 0, detail);
    assert.ok(measured.sameLayer && measured.focused, detail);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify({ headless: true, results }));
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({ headless: true, results }, null, 2),
  );
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
