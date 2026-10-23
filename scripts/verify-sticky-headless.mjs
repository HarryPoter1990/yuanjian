import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// This exercises the built renderer, never starts Electron or accesses user notes.
const output = path.resolve('artifacts/sticky-headless');
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
  '# 便笺验收：写代码时查阅笔记',
  '',
  '这是独立生成的验收笔记。'.repeat(20),
  '',
  '```java',
  'static int sum(int n) { return n * (n + 1) / 2; }',
  '```',
  '',
  '$$',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '$$',
  '',
  '| 项目 | 检查 |',
  '| --- | --- |',
  '| 便笺 | 内容保留 |',
  '',
  '- [ ] 验收任务',
  '',
  '最后一段用于检查编辑、光标和撤销。',
].join('\n');
const note = (id, title, content) => ({
  id,
  path: `isolated-fixture/${title}.md`,
  title,
  content,
  baseContent: content,
  hash: `fixture-${id}`,
  modifiedAt: 1,
  dirty: false,
  cursor: 0,
  scrollTop: 0,
  mode: 'live',
});
const first = note('first', '便笺验收', source);
const second = note('second', '第二份笔记', '# 第二份笔记\n\n切换笔记不丢草稿。');
const settings = structuredClone(defaultSettings);
settings.autoSave = false;
const boot = {
  settings,
  session: { tabs: [first, second], activeId: first.id },
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
      let mode = { mode: 'full', pinned: false };
      let stickyPinned = true;
      const listeners = new Set();
      const state = {
        boot,
        modeCalls: [],
        pinCalls: [],
        settingsWrites: [],
        savedSession: null,
        rejectMode: false,
      };
      window.__stickyFixture = state;
      const api = {
        bootstrap: async () => clone(boot),
        getWindowMode: async () => clone(mode),
        setWindowMode: async (next) => {
          state.modeCalls.push(next);
          if (state.rejectMode) throw new Error('模拟窗口切换失败');
          mode = { mode: next, pinned: next === 'sticky' && stickyPinned };
          for (const callback of listeners) callback(clone(mode));
          return clone(mode);
        },
        setStickyPinned: async (pinned) => {
          if (mode.mode !== 'sticky') throw new Error('Not in sticky mode');
          stickyPinned = pinned;
          state.pinCalls.push(pinned);
          mode = { mode: 'sticky', pinned };
          for (const callback of listeners) callback(clone(mode));
          return clone(mode);
        },
        onWindowModeChanged: (callback) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
        saveSession: async (value) => {
          state.savedSession = clone(value);
        },
        saveSettings: async (value) => {
          state.settingsWrites.push(clone(value));
          boot.settings = clone(value);
          return clone(value);
        },
        setWindowTheme: async () => {},
        openFile: async (file) => clone(boot.session.tabs.find((tab) => tab.path === file) || null),
        getTree: async () => [],
        getIndex: async () => [],
        getFonts: async () => [],
        getFontCatalog: async () => [],
        onFilesChanged: () => () => {},
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
  await expect(page.locator('.cm-content')).toContainText('便笺验收');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const wallpaper = document.createElement('div');
    wallpaper.id = 'divider-fixture-wallpaper';
    wallpaper.className = 'wallpaper';
    wallpaper.style.background = 'linear-gradient(125deg, #43d4c9, #ffda9c 50%, #d790a0)';
    document.querySelector('.app').prepend(wallpaper);
  });
  const dividerGeometry = await page.evaluate(() => {
    const left = document.querySelector('.left-sidebar').getBoundingClientRect();
    const editor = document.querySelector('.editor-column').getBoundingClientRect();
    const right = document.querySelector('.right-sidebar').getBoundingClientRect();
    const dividers = [...document.querySelectorAll('.panel-resizer')];
    return {
      gaps: [editor.left - left.right, right.left - editor.right],
      headerAligned:
        document.querySelector('.app-brand').getBoundingClientRect().right === editor.left,
      grabWidths: dividers.map((element) => element.getBoundingClientRect().width),
      lineWidths: dividers.map((element) => getComputedStyle(element, '::before').width),
      scrollEdgesUncovered: [left.right - 2, editor.right - 2].every(
        (x) => !document.elementFromPoint(x, editor.top + 120)?.closest('.panel-resizer'),
      ),
      grabAreasReachable: dividers.every((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.left + 1, rect.right - 1].every(
          (x) => document.elementFromPoint(x, rect.top + 120) === element,
        );
      }),
    };
  });
  await page.screenshot({ path: path.join(output, 'divider-wallpaper.png') });
  expect(dividerGeometry.gaps).toEqual([1, 1]);
  expect(dividerGeometry.headerAligned).toBe(true);
  expect(dividerGeometry.grabWidths.every((width) => width >= 8)).toBe(true);
  expect(dividerGeometry.lineWidths).toEqual(['1px', '1px']);
  expect(dividerGeometry.scrollEdgesUncovered).toBe(true);
  expect(dividerGeometry.grabAreasReachable).toBe(true);
  const divider = page.getByRole('separator', { name: '调整左侧栏宽度', exact: true });
  await divider.hover();
  expect(
    await divider.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      lineWidth: getComputedStyle(element, '::before').width,
    })),
  ).toEqual({ background: 'rgba(0, 0, 0, 0)', lineWidth: '1px' });
  await page.evaluate(() => document.getElementById('divider-fixture-wallpaper').remove());
  await page.evaluate(() => {
    window.__originalEditor = document.querySelector('.cm-editor');
    window.__originalContent = document.querySelector('.cm-content');
  });
  const enter = () => page.getByRole('button', { name: '进入便笺模式', exact: true }).click();
  const back = () => page.getByRole('button', { name: '返回完整窗口', exact: true }).click();
  const checkSameEditor = async () => {
    expect(
      await page.evaluate(
        () =>
          document.querySelector('.cm-editor') === window.__originalEditor &&
          document.querySelector('.cm-content') === window.__originalContent,
      ),
    ).toBe(true);
  };
  const dragGeometry = [];
  const checkStickyGrabArea = async () => {
    const geometry = await page.evaluate(() => {
      const header = document.querySelector('.sticky-header');
      const grip = header.querySelector('.sticky-drag-handle');
      if (!grip) throw new Error('Sticky window is missing its drag handle');
      const box = (element) => {
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      const dragAt = (x, y) => {
        let drag = false;
        for (
          let element = document.elementFromPoint(x, y);
          element;
          element = element.parentElement
        ) {
          const region = getComputedStyle(element).getPropertyValue('-webkit-app-region');
          if (region === 'no-drag') return false;
          if (region === 'drag') drag = true;
        }
        return drag;
      };
      const gripBox = box(grip);
      const headerBox = box(header);
      const controls = [...header.querySelectorAll('button')].map((element) => {
        const bounds = box(element);
        return {
          ...bounds,
          label: element.getAttribute('aria-label'),
          drag: dragAt((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2),
        };
      });
      return {
        width: innerWidth,
        header: headerBox,
        grip: gripBox,
        fullGripDraggable: [0.2, 0.5, 0.8].every((fraction) =>
          [0.1, 0.5, 0.9].every((x) =>
            dragAt(gripBox.left + gripBox.width * x, gripBox.top + gripBox.height * fraction),
          ),
        ),
        controls,
        controlsDoNotOverlap: controls.every(
          (control, index) =>
            control.left >= gripBox.right &&
            control.right <= headerBox.right - 138 &&
            controls.every(
              (other, otherIndex) =>
                index === otherIndex || control.right <= other.left || control.left >= other.right,
            ),
        ),
        bodyDraggable: dragAt(40, headerBox.bottom + 80),
        fits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(geometry.grip.width).toBeGreaterThanOrEqual(32);
    expect(geometry.grip.height).toBeGreaterThanOrEqual(geometry.header.height - 1);
    expect(geometry.fullGripDraggable).toBe(true);
    expect(geometry.controls).toHaveLength(4);
    expect(geometry.controls.every((control) => control.width >= 24 && !control.drag)).toBe(true);
    expect(geometry.controlsDoNotOverlap).toBe(true);
    expect(geometry.bodyDraggable).toBe(false);
    expect(geometry.fits).toBe(true);
    dragGeometry.push(geometry);
  };
  await enter();
  await page.setViewportSize({ width: 420, height: 640 });
  await expect(page.locator('.app')).toHaveAttribute('data-window-mode', 'sticky');
  await checkSameEditor();
  await checkStickyGrabArea();
  await expect(page.getByRole('button', { name: '便笺始终置顶', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.left-sidebar')).not.toBeVisible();
  await expect(page.locator('.right-sidebar')).not.toBeVisible();
  const pageWidth = await page.evaluate(() => ({
    width: innerWidth,
    body: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.body).toBeLessThanOrEqual(pageWidth.width);
  await page.screenshot({ path: path.join(output, 'sticky-light.png') });
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('便笺新增文字');
  const selection = await page.locator('.cm-content').evaluate((element) => {
    const view = element.cmTile?.root?.view;
    if (!view) throw new Error('Mounted CodeMirror view missing');
    return { anchor: view.state.selection.main.anchor, source: view.state.doc.toString() };
  });
  expect(selection.source).toBe(source + '便笺新增文字');
  await page.getByRole('button', { name: '便笺始终置顶', exact: true }).click();
  await expect(page.getByRole('button', { name: '便笺始终置顶', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await back();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkSameEditor();
  await expect(page.locator('.app')).toHaveAttribute('data-window-mode', 'full');
  expect(
    await page.locator('.cm-content').evaluate((element) => {
      const view = element.cmTile.root.view;
      return { anchor: view.state.selection.main.anchor, source: view.state.doc.toString() };
    }),
  ).toEqual(selection);
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  expect(
    await page
      .locator('.cm-content')
      .evaluate((element) => element.cmTile.root.view.state.doc.toString()),
  ).toBe(source);
  await enter();
  await page.setViewportSize({ width: 420, height: 640 });
  await expect(page.getByRole('button', { name: '便笺始终置顶', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: '切换便笺笔记', exact: true }).click();
  await page
    .getByRole('menu', { name: '便笺笔记', exact: true })
    .getByRole('menuitem')
    .filter({ hasText: '第二份笔记' })
    .click();
  await expect(page.locator('.cm-content')).toContainText('切换笔记不丢草稿');
  await page.keyboard.press('Control+,');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.app')).toHaveAttribute('data-window-mode', 'full');
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__stickyFixture.settingsWrites)).toEqual([]);
  await dialog.getByRole('combobox', { name: '明暗模式', exact: true }).selectOption('dark');
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() => page.evaluate(() => window.__stickyFixture.settingsWrites.length))
    .toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await enter();
  await page.setViewportSize({ width: 320, height: 280 });
  await expect(page.getByRole('button', { name: '返回完整窗口', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '便笺更多操作', exact: true })).toBeVisible();
  await checkStickyGrabArea();
  await page.getByRole('button', { name: '切换便笺笔记', exact: true }).click();
  await expect(page.getByRole('menu', { name: '便笺笔记', exact: true })).toBeVisible();
  await page
    .getByRole('menu', { name: '便笺笔记', exact: true })
    .getByRole('menuitem')
    .filter({ hasText: '便笺验收' })
    .click();
  await expect(page.locator('.cm-content')).toContainText('便笺验收');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(output, 'sticky-small.png') });
  await page.setViewportSize({ width: 420, height: 640 });
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(output, 'sticky-dark.png') });
  await page.getByRole('button', { name: '便笺更多操作', exact: true }).click();
  await page
    .getByRole('menu', { name: '便笺操作', exact: true })
    .getByRole('menuitem', { name: '新建空白笔记', exact: true })
    .click();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('便笺草稿：返回完整窗口后仍保留。');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__stickyFixture.savedSession?.tabs.find((tab) => !tab.path)?.content,
      ),
    )
    .toBe('便笺草稿：返回完整窗口后仍保留。');
  await back();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    window.__stickyFixture.rejectMode = true;
  });
  await enter();
  await expect(page.locator('.app')).toHaveAttribute('data-window-mode', 'full');
  await expect(page.getByText(/模拟窗口切换失败/)).toBeVisible();
  const fixtureState = await page.evaluate(() => window.__stickyFixture);
  expect(fixtureState.settingsWrites).toHaveLength(1);
  expect(fixtureState.settingsWrites[0]).toEqual({
    ...settings,
    appearance: { ...settings.appearance, mode: 'dark' },
  });
  expect(fixtureState.savedSession.tabs).toHaveLength(3);
  expect(errors).toEqual([]);
  const report = {
    headless: true,
    bridge: 'isolated in-memory fixture; native window behavior not exercised',
    editorIdentityPreserved: true,
    contentSelectionUndoPreserved: true,
    pinAndNoteSwitch: true,
    fullModeBeforeSettings: true,
    appearanceAndPanelPreferencesPreserved: true,
    draftSessionPreserved: true,
    failedModeChangeProtected: true,
    settingsWrites: fixtureState.settingsWrites.length,
    dividerGeometry,
    dragGeometry,
    modeCalls: fixtureState.modeCalls,
    errors,
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
