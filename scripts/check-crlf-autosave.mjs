import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Built App, generated CRLF notes, and an in-memory store; never writes user files or starts Electron.
const output = path.resolve('artifacts/crlf-autosave');
await mkdir(output, { recursive: true });
const bundled = await build({
  entryPoints: ['src/shared/defaults.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { defaultSettings } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const source = [
  '### Windows 行尾回归验证',
  '',
  '这段内容由验证脚本生成，不来自用户笔记。',
  '',
  '- [ ] 自动保存验证',
  '',
  '末段。',
].join('\r\n');
const note = (id, title, content) => ({
  id,
  path: `isolated-fixture/${title}.md`,
  title,
  content,
  baseContent: content,
  hash: `fixture-${id}`,
  modifiedAt: 1,
  dirty: false,
  cursor: content.replace(/\r\n/g, '\n').length,
  scrollTop: 0,
  mode: 'live',
});
const first = note('first', 'CRLF 回归', source);
const settings = structuredClone(defaultSettings);
settings.autoSave = true;
const boot = {
  settings,
  session: { tabs: [first], activeId: first.id },
  fonts: [],
  version: 'headless-fixture',
  dataDirectory: 'isolated-memory',
};
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const dist = path.resolve('dist');
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(dist, `.${pathname}`);
    if (!file.startsWith(dist + path.sep)) throw new Error('Outside dist');
    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
const errors = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(
    ({ boot }) => {
      const clone = (value) => structuredClone(value);
      let stored = clone(boot.session.tabs[0]);
      const fileListeners = new Set();
      const state = {
        savedSession: null,
        saveCalls: [],
      };
      window.__crlfFixture = state;
      const api = {
        bootstrap: async () => clone(boot),
        getWindowMode: async () => ({ mode: 'full', pinned: false }),
        setWindowMode: async () => {
          throw new Error('Window mode is outside this fixture');
        },
        setStickyPinned: async () => {
          throw new Error('Pinning is outside this fixture');
        },
        onWindowModeChanged: () => () => {},
        saveSession: async (value) => {
          state.savedSession = clone(value);
        },
        saveSettings: async (value) => {
          boot.settings = clone(value);
          return clone(value);
        },
        setWindowTheme: async () => {},
        openFile: async (file) => clone(file === stored.path ? stored : null),
        getTree: async () => [],
        saveFile: async (request) => {
          const content = request.content.replace(/\r?\n/g, '\r\n');
          state.saveCalls.push({
            time: performance.now(),
            inputHasCRLF: request.content.includes('\r\n'),
            returnedCRLF: content.includes('\r\n'),
          });
          const changed = content !== stored.content;
          stored = {
            ...stored,
            content,
            hash: changed ? `fixture-${state.saveCalls.length}` : stored.hash,
          };
          // Model asynchronous file IO and the normal file watcher callback without touching disk.
          await new Promise((resolve) => setTimeout(resolve, 15));
          if (changed) for (const callback of fileListeners) callback([stored.path]);
          return { status: 'saved', note: clone(stored) };
        },
        getIndex: async () => [],
        getFonts: async () => [],
        getFontCatalog: async () => [],
        onFilesChanged: (callback) => {
          fileListeners.add(callback);
          return () => fileListeners.delete(callback);
        },
        onCloseRequested: () => () => {},
        onOpenRequested: () => () => {},
        onProgress: () => () => {},
      };
      window.notes = new Proxy(api, {
        get(target, key) {
          if (key in target) return target[key];
          throw new Error(`Fixture API not provided: ${String(key)}`);
        },
      });
    },
    { boot },
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await expect(page.locator('h3')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('h3').click({ position: { x: 150, y: 12 } });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const v = document.querySelector('.cm-content').cmTile.root.view;
    window.crlfInitialDoc = v.state.doc;
    window.crlfInitialHeading = document.querySelector('.cm-heading-source');
    window.crlfMutations = 0;
    window.crlfObserver = new MutationObserver((ms) => (window.crlfMutations += ms.length));
    window.crlfObserver.observe(v.contentDOM, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  // More than three 850ms autosave periods, without input or simulated file writes.
  await page.waitForTimeout(3200);
  const initial = await page.evaluate(() => {
    window.crlfObserver.disconnect();
    const v = document.querySelector('.cm-content').cmTile.root.view,
      s = v.state.selection.main;
    return {
      saveCalls: window.__crlfFixture.saveCalls.length,
      mutations: window.crlfMutations,
      sameDoc: v.state.doc === window.crlfInitialDoc,
      sameHeading: document.querySelector('.cm-heading-source') === window.crlfInitialHeading,
      source: v.state.doc.toString(),
      anchor: s.anchor,
      head: s.head,
      focused: v.hasFocus,
    };
  });
  const canonical = source.replace(/\r\n/g, '\n');
  assert.equal(
    initial.saveCalls,
    0,
    'Opening a CRLF note must not mark it dirty or trigger autosave',
  );
  assert.equal(initial.mutations, 0, 'Idle source content must not be rebuilt by normalization');
  assert.equal(initial.sameDoc, true);
  assert.equal(initial.sameHeading, true);
  assert.equal(initial.source, canonical);
  assert.equal(initial.focused, true);
  const inserted = '编辑验证';
  await page.keyboard.insertText(inserted);
  const expected = canonical.slice(0, initial.head) + inserted + canonical.slice(initial.head);
  await page.locator('.cm-content').evaluate(
    (el, { head, length }) => {
      const v = el.cmTile.root.view;
      v.dispatch({ selection: { anchor: head + length, head } });
      window.crlfEditedDoc = v.state.doc;
      window.crlfEditedHeading = document.querySelector('.cm-heading-source');
    },
    { head: initial.head, length: inserted.length },
  );
  await expect.poll(() => page.evaluate(() => window.__crlfFixture.saveCalls.length)).toBe(1);
  // After the one intentional edit has saved, verify it does not start another normalization loop.
  await page.waitForTimeout(2000);
  const saved = await page.evaluate(() => {
    const v = document.querySelector('.cm-content').cmTile.root.view,
      s = v.state.selection.main;
    return {
      saveCalls: window.__crlfFixture.saveCalls,
      sameDoc: v.state.doc === window.crlfEditedDoc,
      sameHeading: document.querySelector('.cm-heading-source') === window.crlfEditedHeading,
      source: v.state.doc.toString(),
      anchor: s.anchor,
      head: s.head,
      focused: v.hasFocus,
    };
  });
  assert.equal(saved.saveCalls.length, 1);
  assert.equal(saved.saveCalls[0].returnedCRLF, true);
  assert.equal(saved.sameDoc, true);
  assert.equal(saved.sameHeading, true);
  assert.equal(saved.source, expected);
  assert.equal(saved.anchor, initial.head + inserted.length);
  assert.equal(saved.head, initial.head);
  assert.equal(saved.focused, true);
  await page.keyboard.press('Control+z');
  assert.equal(
    await page.locator('.cm-content').evaluate((el) => el.cmTile.root.view.state.doc.toString()),
    canonical,
  );
  await page.keyboard.press('Control+y');
  assert.equal(
    await page.locator('.cm-content').evaluate((el) => el.cmTile.root.view.state.doc.toString()),
    expected,
  );
  assert.deepEqual(errors, []);
  const report = {
    headless: true,
    builtApp: true,
    inMemoryStore: true,
    idleMs: 3200,
    idleSaveCalls: initial.saveCalls,
    idleContentMutations: initial.mutations,
    idleDocStable: initial.sameDoc,
    idleHeadingStable: initial.sameHeading,
    savedCalls: saved.saveCalls.length,
    savedReturnedCRLF: true,
    postSaveIdleMs: 2000,
    savedDocStable: saved.sameDoc,
    savedHeadingStable: saved.sameHeading,
    selectionPreserved: true,
    undoRedoPreserved: true,
    errors,
  };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
