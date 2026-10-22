// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { longArticle } from '../src/editor/fixtures/long-article';

const project = fileURLToPath(new URL('../', import.meta.url));
let server: ViteDevServer;
let app: ElectronApplication;
let page: Page;
const errors: string[] = [];
const processEvents: string[] = [];
beforeAll(async () => {
  await mkdir(path.join(project, '.test-data', 'editor-browser-profile'), { recursive: true });
  server = await createServer({
    configFile: false,
    root: project,
    server: {
      host: '127.0.0.1',
      port: 0,
      watch: { ignored: ['**/.test-data/**', '**/dist/**', '**/release/**'] },
    },
    optimizeDeps: { entries: ['src/editor/fixtures/verify.html'] },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a local port');
  const environment: Record<string, string> = {
    EDITOR_TEST_URL: `http://127.0.0.1:${address.port}/src/editor/fixtures/verify.html`,
  };
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) environment[key] = value;
  environment.EDITOR_TEST_URL = `http://127.0.0.1:${address.port}/src/editor/fixtures/verify.html`;
  delete environment.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [
      path.join(project, 'src', 'editor', 'fixtures', 'verify-electron.cjs'),
      `--user-data-dir=${path.join(project, '.test-data', 'editor-browser-profile')}`,
    ],
    env: environment,
  });
  page = await app.firstWindow();
  page.on('crash', () => processEvents.push('page-crash'));
  app.process().on('exit', (code) => processEvents.push(`process-exit:${code}`));
  await app.evaluate(({ BrowserWindow }) => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'editorRenderEvents', { value: events });
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.on('render-process-gone', (_event, details) =>
        events.push(JSON.stringify(details)),
      );
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByRole('button', { name: '完整源码', exact: true }).waitFor();
}, 60000);
afterAll(async () => {
  await app?.close();
  await server?.close();
});

describe('isolated real Electron editor', () => {
  it('renders diagrams and math, edits Chinese source, grids and links without source drift', async () => {
    const original = await readFile(
      path.join(project, 'src', 'editor', 'fixtures', '编辑器验收.md'),
      'utf8',
    );
    const source = page.getByTestId('source-value');
    await expect.poll(() => source.inputValue()).toBe(original);
    const paragraph = page.locator('.markdown-preview-block').filter({ hasText: '这个文件包含' });
    await paragraph.locator('p').click({ position: { x: 50, y: 12 } });
    await page.keyboard.press('Home');
    await page.keyboard.insertText('中文验收：');
    const expected = original.replace('这个文件包含', '中文验收：这个文件包含');
    await expect.poll(() => source.inputValue()).toBe(expected);
    await page.getByRole('button', { name: '完整源码', exact: true }).click();
    await expect.poll(() => page.locator('.markdown-preview-block').count()).toBe(0);
    await expect.poll(() => source.inputValue()).toBe(expected);
    await page.getByRole('button', { name: '即时排版', exact: true }).click();
    const cell = page.getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true });
    await cell.fill('网格中文');
    await cell.press('Tab');
    await expect
      .poll(() => source.inputValue())
      .toBe(expected.replace('| 中文单元格 | 3 | 点击编辑 |', '| 网格中文 | 3 | 点击编辑 |'));
    await expect
      .poll(() =>
        page
          .getByRole('textbox', { name: '表格第 2 行第 2 列', exact: true })
          .evaluate((input) => input === document.activeElement),
      )
      .toBe(true);
    await page.getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true }).fill('中文单元格');
    await page.getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true }).press('Tab');
    await expect.poll(() => source.inputValue()).toBe(expected);
    await page.getByRole('button', { name: '公式位置', exact: true }).click();
    const formula = page.locator('.markdown-preview-block').filter({ hasText: '行内公式：' });
    await formula.scrollIntoViewIfNeeded();
    expect(await page.locator('.katex').count()).toBeGreaterThan(0);
    await formula.locator('p').click({ position: { x: 20, y: 12 } });
    await expect
      .poll(() => page.locator('.cm-line').filter({ hasText: '行内公式：$E=mc^2$' }).count())
      .toBe(1);
    await expect.poll(() => source.inputValue()).toBe(expected);
    await page.getByRole('button', { name: '流程图位置', exact: true }).click();
    const firstDiagram = page.locator('.mermaid-diagram').first();
    await firstDiagram.scrollIntoViewIfNeeded();
    await page.locator('.mermaid-diagram svg').first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(project, '.test-data', 'editor-flowchart.png') });
    await page.getByRole('button', { name: '时序图位置', exact: true }).click();
    await page.locator('.mermaid-diagram svg').last().waitFor({ timeout: 30000 });
    expect(await page.locator('.mermaid-diagram[data-rendered="error"]').count()).toBe(0);
    await page.getByRole('button', { name: '链接位置', exact: true }).click();
    await page.getByRole('link', { name: 'Wiki 链接', exact: true }).click();
    await expect.poll(() => page.getByTestId('link-target').innerText()).toBe('同名笔记#目标');
    const dimensions = await page
      .locator('.markdown-preview-block')
      .first()
      .evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        lineHeight: getComputedStyle(element).lineHeight,
      }));
    expect(dimensions.height).toBeGreaterThan(20);
    await page.getByRole('button', { name: '文首', exact: true }).click();
    await page.screenshot({ path: path.join(project, '.test-data', 'editor-browser.png') });
    expect(errors).toEqual([]);
  }, 60000);
  it('keeps adjacent rendered blocks within one source blank line', async () => {
    await page.getByRole('button', { name: '程序位置', exact: true }).click();
    await page.getByRole('heading', { name: '代码与图表', exact: true }).waitFor();
    const geometry = await page.locator('.cm-content').evaluate((content) => {
      const heading = Array.from(content.querySelectorAll('h2')).find(
        (element) => element.textContent === '代码与图表',
      );
      const code = content.querySelector<HTMLElement>('.code-language-toolbar');
      if (!heading || !code) throw new Error('Missing geometry targets');
      return {
        gap: code.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
        lineHeight: parseFloat(getComputedStyle(content).lineHeight),
        nodes: Array.from(content.children).map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.textContent?.slice(0, 24),
          top: element.getBoundingClientRect().top,
          height: element.getBoundingClientRect().height,
          margin: getComputedStyle(element).margin,
          padding: getComputedStyle(element).padding,
        })),
      };
    });
    await writeFile(
      path.join(project, '.test-data', 'editor-geometry.json'),
      JSON.stringify(geometry, null, 2),
    );
    console.log(
      'EDITOR_VERTICAL_GEOMETRY',
      JSON.stringify({ gap: geometry.gap, lineHeight: geometry.lineHeight }),
    );
    expect(geometry.gap).toBeLessThanOrEqual(geometry.lineHeight * 1.75 + 8);
    await page.screenshot({ path: path.join(project, '.test-data', 'editor-spacing.png') });
  }, 30000);
  it('keeps the full 4921-line Chinese article editable without an independent renderer stall', async () => {
    const started = performance.now();
    await page.goto(`${page.url().split('?')[0]}?long=1`);
    const source = page.getByTestId('source-value');
    await expect.poll(() => source.inputValue(), { timeout: 20000 }).toBe(longArticle);
    const openedMs = performance.now() - started;
    await page.getByRole('button', { name: '完整源码', exact: true }).click();
    await page.locator('.cm-content').click();
    const beforeEnd = performance.now();
    await page.keyboard.press('Control+End');
    const controlEndMs = performance.now() - beforeEnd;
    const beforeState = await page.evaluate(() => {
      const view = Reflect.get(window, 'editorVerify').getView();
      return {
        length: view.state.doc.length,
        head: view.state.selection.main.head,
        lines: view.state.doc.lines,
        sourceMode: Boolean(document.querySelector('.markdown-editor.is-source')),
      };
    });
    expect(beforeState).toEqual({
      length: longArticle.length,
      head: longArticle.length,
      lines: 4921,
      sourceMode: true,
    });
    const beforeInsert = performance.now();
    await page.keyboard.insertText('长文追加完成。');
    await expect
      .poll(() => source.inputValue(), { timeout: 20000 })
      .toBe(longArticle + '长文追加完成。');
    const insertAndChangeMs = performance.now() - beforeInsert;
    await page.getByRole('button', { name: '即时排版', exact: true }).click();
    await expect
      .poll(() => source.inputValue(), { timeout: 20000 })
      .toBe(longArticle + '长文追加完成。');
    const afterState = await page.evaluate(() => {
      const view = Reflect.get(window, 'editorVerify').getView();
      return {
        length: view.state.doc.length,
        head: view.state.selection.main.head,
        lines: view.state.doc.lines,
        liveMode: Boolean(document.querySelector('.markdown-editor.is-live')),
        renderedNodes: document.querySelectorAll('.markdown-preview-block').length,
      };
    });
    expect(afterState.length).toBe(longArticle.length + '长文追加完成。'.length);
    expect(afterState.head).toBe(afterState.length);
    expect(afterState.liveMode).toBe(true);
    const rendererProcessGone: unknown = await app.evaluate(() =>
      Reflect.get(globalThis, 'editorRenderEvents'),
    );
    await writeFile(
      path.join(project, '.test-data', 'editor-long-article.json'),
      JSON.stringify(
        {
          bytes: Buffer.byteLength(longArticle),
          openedMs,
          controlEndMs,
          insertAndChangeMs,
          totalMs: performance.now() - started,
          beforeState,
          afterState,
          errors,
          processEvents,
          rendererProcessGone,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
    expect(processEvents).toEqual([]);
    expect(rendererProcessGone).toEqual([]);
  }, 60000);
});
