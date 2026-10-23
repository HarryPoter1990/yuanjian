// Only generated notes in headless Edge; no Electron windows, user notes, or settings.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({
  stdin: {
    contents: `
      import React, {createRef,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {MarkdownEditor} from './src/editor/MarkdownEditor';
      import {defaultSettings} from './src/shared/defaults';
      const ref=createRef(), root=createRoot(document.getElementById('root'));
      let instance=0;
      window.notes={assetUrl:async()=>''};
      function Fixture({source,mode,appearance}){
        const [value,setValue]=useState(source),[,setCursor]=useState(0);
        const settings={...defaultSettings,appearance:{...defaultSettings.appearance,...appearance}};
        return <div className="app" data-theme="light" style={{height:'100vh',
          '--body-font':settings.appearance.bodyFont,'--heading-font':settings.appearance.headingFont,
          '--code-font':settings.appearance.codeFont,'--editor-opacity':settings.appearance.editorOpacity}}>
          <div className="wallpaper" style={{background:'linear-gradient(125deg,#75a9a0,#e8d8b9,#ae8f9e)',opacity:settings.appearance.wallpaperOpacity,filter:'blur('+settings.appearance.wallpaperBlur+'px)',display:'none'}} />
          <main className="editor-column" style={{height:'100%',width:'100%'}}><div className="editor-surface">
            <MarkdownEditor ref={ref} value={value} initialCursor={source.length} mode={mode}
              settings={settings} onChange={setValue} onCursor={setCursor}/>
          </div></main>
        </div>
      }
      window.headingFixture={
        reset(source,mode='live',appearance={}){
          flushSync(()=>root.render(<Fixture key={++instance} source={source} mode={mode} appearance={appearance}/>));
          ref.current.getView().focus();
        },
        view:()=>ref.current.getView(),
      };
      window.headingFixture.reset('');
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
    readFile('node_modules/@fontsource-variable/noto-sans-sc/index.css', 'utf8').then((css) =>
      css.replaceAll('./files/', '/node_modules/@fontsource-variable/noto-sans-sc/files/'),
    ),
    readFile('node_modules/@fontsource/jetbrains-mono/index.css', 'utf8').then((css) =>
      css.replaceAll('./files/', '/node_modules/@fontsource/jetbrains-mono/files/'),
    ),
  ])
).join('\n');
const server = createServer(async (request, response) => {
  if (
    /^\/node_modules\/(?:@fontsource-variable\/noto-sans-sc|@fontsource\/jetbrains-mono)\/files\/[\w.-]+\.woff2?$/.test(
      request.url,
    )
  ) {
    response.setHeader('Content-Type', 'font/woff2');
    response.end(await readFile('.' + request.url));
    return;
  }
  const script = request.url === '/fixture.js',
    style = request.url === '/fixture.css';
  response.setHeader(
    'Content-Type',
    script ? 'text/javascript' : style ? 'text/css' : 'text/html; charset=utf-8',
  );
  response.end(
    script
      ? bundle.outputFiles[0].text
      : style
        ? css
        : '<!doctype html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const errors = [],
  geometry = [],
  selections = [],
  idle = [];
const profiles = [
  { name: 'defaults', appearance: {} },
  {
    name: 'reported-appearance',
    appearance: {
      fontSize: 16,
      lineHeight: 1.85,
      contentWidth: 800,
      editorOpacity: 0.8,
      wallpaperOpacity: 1,
      wallpaperBlur: 0,
    },
  },
];
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.locator('.cm-content')).toBeVisible();
  const reset = async (source, appearance = {}) => {
    await page.evaluate(
      ({ source, appearance }) => window.headingFixture.reset(source, 'live', appearance),
      { source, appearance },
    );
    await page.evaluate(() => document.fonts.ready);
  };
  const state = () =>
    page.evaluate(() => {
      const v = window.headingFixture.view(),
        s = v.state.selection.main;
      return { source: v.state.doc.toString(), anchor: s.anchor, head: s.head };
    });
  for (const profile of profiles)
    for (const width of [1000, 420]) {
      await page.setViewportSize({ width, height: 800 });
      for (const level of [1, 2, 3, 4, 5, 6])
        for (const variant of ['plain', 'closing', 'spaced']) {
          const prefix =
              (variant === 'spaced' ? '  ' : '') +
              '#'.repeat(level) +
              (variant === 'spaced' ? '   ' : ' '),
            title = '阶段练习：TeamFlow Console（控制台原型）';
          const source =
            prefix + title + (variant === 'plain' ? '' : '  ###  ') + '\n\n正文第一段。\n\n尾段';
          await reset(source, profile.appearance);
          const heading = page.locator(`h${level}`);
          const before = await heading.evaluate((el) => {
            const marker = el.querySelector('.markdown-heading-prefix');
            const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
            const r = document.createRange();
            r.setStart(node, 0);
            r.setEnd(node, 1);
            return {
              first: r.getBoundingClientRect().toJSON(),
              box: el.parentElement.getBoundingClientRect().toJSON(),
              font: getComputedStyle(el).font,
              marker: marker?.textContent,
            };
          });
          assert.equal(before.marker, prefix, 'preview must reserve the real editable prefix');
          await page.mouse.click(
            before.first.x + before.first.width / 2,
            before.first.y + before.first.height / 2,
          );
          const after = await page.locator('.cm-heading-source').evaluate((el, prefixLength) => {
            const v = window.headingFixture.view(),
              at = v.domAtPos(prefixLength),
              r = document.createRange();
            r.setStart(at.node, at.offset);
            r.setEnd(at.node, at.offset + 1);
            return {
              first: r.getBoundingClientRect().toJSON(),
              box: el.getBoundingClientRect().toJSON(),
              font: getComputedStyle(el).font,
            };
          }, prefix.length);
          for (const key of ['x', 'y'])
            assert.ok(
              Math.abs(before.first[key] - after.first[key]) < 1,
              `H${level}, width ${width}: text ${key} must stay aligned ${JSON.stringify({ before, after })}`,
            );
          assert.ok(
            Math.abs(before.box.height - after.box.height) < 1,
            `H${level}, width ${width}: outer height must stay stable ${JSON.stringify({ profile, before, after })}`,
          );
          assert.equal(before.font, after.font);
          assert.equal((await state()).source, source);
          geometry.push({ profile: profile.name, width, level, variant, before, after });
        }
    }
  await page.setViewportSize({ width: 1000, height: 800 });
  const source = '### 阶段练习：TeamFlow Console（控制台原型）\n\n第二段普通正文。\n\n尾段';
  for (const reverse of [false, true]) {
    await reset(source);
    const points = await page.locator('h3').evaluate((el) => {
      const n = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
      return [1, 12].map((offset) => {
        const r = document.createRange();
        r.setStart(n, offset);
        r.collapse(true);
        const b = r.getBoundingClientRect();
        return { x: b.x + 0.1, y: b.y + b.height / 2 };
      });
    });
    const [start, end] = reverse ? points.reverse() : points;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    const selected = await state();
    assert.equal(
      selected.anchor,
      4 + (reverse ? 12 : 1),
      JSON.stringify({ reverse, selected, start, end }),
    );
    assert.equal(
      selected.head,
      4 + (reverse ? 1 : 12),
      JSON.stringify({ reverse, selected, start, end }),
    );
    assert.equal(selected.source, source);
    await page.waitForTimeout(300);
    assert.deepEqual(
      await state(),
      selected,
      'drag selection must survive the pending focus correction',
    );
    selections.push({ reverse, ...selected });
  }
  // Observe the active source text independently of the caret's regular opacity animation.
  for (const profile of profiles)
    for (const reducedMotion of ['no-preference', 'reduce'])
      for (const wallpaper of [false, true]) {
        await page.emulateMedia({ reducedMotion });
        await reset(source, profile.appearance);
        await page.evaluate((wallpaper) => {
          document.querySelector('.wallpaper').style.display = wallpaper ? 'block' : 'none';
          const v = window.headingFixture.view();
          v.dispatch({ selection: { anchor: 24 } });
          v.focus();
          window.headingMutations = 0;
          window.headingNode = document.querySelector('.cm-heading-source');
          window.headingFocusEvents = [];
          for (const type of ['focus', 'blur'])
            v.contentDOM.addEventListener(type, () => window.headingFocusEvents.push(type));
          window.headingObserver = new MutationObserver(
            (ms) => (window.headingMutations += ms.length),
          );
          window.headingObserver.observe(window.headingNode, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true,
          });
        }, wallpaper);
        await page.mouse.move(990, 790);
        await page.waitForTimeout(100);
        const bounds = await page.locator('.cm-heading-source').evaluate((el) => {
          const b = el.getBoundingClientRect();
          return {
            x: Math.ceil(b.x + 48),
            y: Math.ceil(b.y),
            width: 100,
            height: Math.floor(b.height),
          };
        });
        const first = await page.screenshot({ clip: bounds, caret: 'initial' });
        let stableFrames = 0,
          rawChangedPixels = 0,
          maxChannelDelta = 0;
        for (let frame = 0; frame < 24; frame++) {
          await page.waitForTimeout(110);
          const image = await page.screenshot({ clip: bounds, caret: 'initial' });
          const difference = first.equals(image)
            ? { changedPixels: 0, significantPixels: 0, maxChannelDelta: 0 }
            : await page.evaluate(
                async (images) => {
                  const data = await Promise.all(
                    images.map(async (base64) => {
                      const image = new Image();
                      image.src = 'data:image/png;base64,' + base64;
                      await image.decode();
                      const canvas = document.createElement('canvas');
                      canvas.width = image.width;
                      canvas.height = image.height;
                      const context = canvas.getContext('2d');
                      context.drawImage(image, 0, 0);
                      return context.getImageData(0, 0, canvas.width, canvas.height).data;
                    }),
                  );
                  let changedPixels = 0,
                    significantPixels = 0,
                    maxChannelDelta = 0;
                  for (let p = 0; p < data[0].length; p += 4) {
                    const delta = Math.max(
                      ...[0, 1, 2, 3].map((c) => Math.abs(data[0][p + c] - data[1][p + c])),
                    );
                    if (delta) changedPixels++;
                    // Static GPU gradients can round a background channel by one 8-bit level.
                    if (delta > 1) significantPixels++;
                    maxChannelDelta = Math.max(maxChannelDelta, delta);
                  }
                  return { changedPixels, significantPixels, maxChannelDelta };
                },
                [first.toString('base64'), image.toString('base64')],
              );
          if (difference.significantPixels) {
            await mkdir('artifacts/heading-interactions', { recursive: true });
            await writeFile('artifacts/heading-interactions/first.png', first);
            await writeFile('artifacts/heading-interactions/changed.png', image);
            await writeFile(
              'artifacts/heading-interactions/pixel-failure.json',
              JSON.stringify(
                {
                  profile,
                  reducedMotion,
                  wallpaper,
                  frame,
                  bounds,
                  difference,
                  dom: await page.locator('.cm-heading-source').evaluate((el) => ({
                    html: el.outerHTML,
                    opacity: getComputedStyle(el).opacity,
                    visibility: getComputedStyle(el).visibility,
                    rect: el.getBoundingClientRect().toJSON(),
                    mutations: window.headingMutations,
                  })),
                },
                null,
                2,
              ),
            );
          }
          assert.ok(
            difference.significantPixels === 0,
            `source text pixels must stay stable: ${reducedMotion}, wallpaper=${wallpaper}`,
          );
          stableFrames++;
          rawChangedPixels += difference.changedPixels;
          maxChannelDelta = Math.max(maxChannelDelta, difference.maxChannelDelta);
        }
        const dom = await page.evaluate(() => {
          window.headingObserver.disconnect();
          const el = document.querySelector('.cm-heading-source'),
            s = getComputedStyle(el);
          const v = window.headingFixture.view();
          return {
            sameNode: el === window.headingNode,
            mutations: window.headingMutations,
            opacity: s.opacity,
            visibility: s.visibility,
            animation: s.animationName,
            focused: v.hasFocus,
            activeElementIsEditor: document.activeElement === v.contentDOM,
            focusEvents: window.headingFocusEvents,
            head: v.state.selection.main.head,
          };
        });
        assert.equal(dom.sameNode, true);
        assert.equal(dom.mutations, 0);
        assert.equal(dom.opacity, '1');
        assert.equal(dom.visibility, 'visible');
        assert.equal(dom.focused, true);
        assert.equal(dom.activeElementIsEditor, true);
        assert.deepEqual(dom.focusEvents, []);
        assert.equal(dom.head, 24);
        idle.push({
          profile: profile.name,
          reducedMotion,
          wallpaper,
          stableFrames,
          rawChangedPixels,
          maxChannelDelta,
          noiseSkipped: rawChangedPixels > 0,
          ...dom,
        });
      }
  assert.deepEqual(errors, []);
  await mkdir('artifacts/heading-interactions', { recursive: true });
  await writeFile(
    'artifacts/heading-interactions/result.json',
    JSON.stringify(
      { headless: true, nativeElectron: false, geometry, selections, idle, errors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      headless: true,
      nativeElectron: false,
      geometryChecks: geometry.length,
      dragChecks: selections.length,
      idle,
      errors,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
