import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { NoteStore } from '../../electron/storage/store';
import { ExportManager } from '../../electron/resources/export';
import { argumentSchemas } from '../../electron/validation';

const [fixture, output, source] = process.argv.slice(2);
assert.ok(path.resolve(fixture).startsWith(path.resolve('.test-data') + path.sep));
assert.ok(path.resolve(output).startsWith(path.resolve('artifacts') + path.sep));
assert.ok(path.resolve(source).startsWith(path.resolve('artifacts') + path.sep));
const isolated = path.join(fixture, randomUUID());
app.setPath('userData', path.join(isolated, 'profile'));
app.setPath('sessionData', path.join(isolated, 'profile'));
app.setPath('logs', path.join(isolated, 'logs'));
let everVisible = false,
  store: NoteStore | undefined;
const windows: BrowserWindow[] = [],
  externalRequests: string[] = [];
const watchdog = setTimeout(() => app.exit(2), 30000);
function hidden(preload?: string) {
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 900,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  windows.push(window);
  window.on('show', () => {
    everVisible = true;
    window.destroy();
    app.exit(1);
  });
  return window;
}
app
  .whenReady()
  .then(async () => {
    const directory = path.join(isolated, 'notes');
    await mkdir(directory, { recursive: true });
    const root = path.join(directory, '主笔记.md'),
      child = path.join(directory, '子笔记.md');
    const rootContent = '# 主笔记\n\n![[子笔记.md]]',
      childContent = '# 定义\n\n生成的引用内容。 ^definition';
    await writeFile(root, rootContent);
    await writeFile(child, childContent);
    store = new NoteStore(path.join(isolated, 'data'));
    await store.initialize();
    await store.approveFile(root);
    const window = hidden(path.resolve('dist-electron/preload.cjs'));
    let calls = 0;
    ipcMain.handle('notes:readEmbeddedNote', (event, ...raw) => {
      assert.equal(event.sender, window.webContents);
      assert.equal(event.senderFrame?.routingId, window.webContents.mainFrame.routingId);
      const [from, target] = argumentSchemas.readEmbeddedNote.parse(raw);
      calls++;
      return store!.readEmbeddedNote(from, target);
    });
    const page = path.join(isolated, 'bridge.html');
    await writeFile(page, '<!doctype html><meta charset="utf-8"><p>生成的桥接测试</p>');
    await window.loadFile(page);
    const read = (from: string, target: string) =>
      window.webContents.executeJavaScript(
        `notes.readEmbeddedNote(${JSON.stringify(from)},${JSON.stringify(target)})`,
      );
    assert.match((await read(root, '子笔记.md')).error, /授权/);
    await assert.rejects(store.authorize(child), /授权/);
    await store.approveFile(child);
    const grants = store.getApprovedPaths();
    assert.deepEqual(await read(root, '子笔记.md'), { path: child, source: childContent });
    assert.deepEqual(store.getApprovedPaths(), grants);
    assert.deepEqual(store.getSession().tabs, []);
    assert.deepEqual(await store.listHistory(), []);
    await assert.rejects(
      window.webContents.executeJavaScript('notes.readEmbeddedNote(12,"child.md")'),
    );
    assert.equal(calls, 2);
    assert.equal(await readFile(root, 'utf8'), rootContent);
    assert.equal(await readFile(child, 'utf8'), childContent);

    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, done) => {
        externalRequests.push(details.url);
        done({ cancel: true });
      },
    );
    const exporter = new ExportManager(store, {
      chooseSave: async (_name, format) => path.join(output, `workspace.${format}`),
      buildDirectory: path.resolve('dist'),
      assetData: async () => {
        throw Error('Unexpected unbundled asset');
      },
      renderPdf: async (htmlFile, target) => {
        const print = hidden();
        await print.loadFile(htmlFile);
        const content = await print.webContents.executeJavaScript(`(async()=>{
        await document.fonts.ready;
        await Promise.all([...document.images].map(image=>image.decode()));
        if([...document.querySelectorAll('details')].some(node=>!node.open))throw Error('PDF hides folded content');
        if(document.querySelector('.note-reference-error'))throw Error('PDF has unresolved reference');
        return document.body.innerText;
      })()`);
        assert.ok(content.includes('这里是折叠内容'));
        assert.ok(content.includes('未保存的新定义'));
        assert.ok(!content.includes('隐藏备注'));
        await writeFile(
          target,
          await print.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            preferCSSPageSize: true,
          }),
        );
        print.destroy();
      },
    });
    for (const format of ['html', 'pdf'] as const) {
      const html = await readFile(path.join(source, `workspace-export.${format}.html`), 'utf8');
      assert.equal(
        await exporter.exportDocument({ format, html, notePath: root, title: '工作区语法检查' }),
        path.join(output, `workspace.${format}`),
      );
    }
    assert.ok(
      (await readFile(path.join(output, 'workspace.pdf')))
        .subarray(0, 5)
        .equals(Buffer.from('%PDF-')),
    );
    const offline = hidden();
    await offline.loadFile(path.join(output, 'workspace.html'));
    const offlineDetails = await offline.webContents.executeJavaScript(
      `(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));return {text:document.body.innerText,folds:document.querySelectorAll('details').length,closed:document.querySelectorAll('details:not([open])').length,images:document.images.length}})()`,
    );
    assert.ok(offlineDetails.text.includes('未保存的新定义'));
    assert.equal(offlineDetails.closed, 2);
    assert.ok(offlineDetails.images > 0);
    assert.deepEqual(externalRequests, []);
    assert.ok(windows.every((window) => window.isDestroyed() || !window.isVisible()));
    await store.dispose();
    await writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          passed: true,
          everVisible,
          electron: process.versions.electron,
          shippedPreload: true,
          sandboxed: true,
          readCalls: calls,
          unapprovedEmbedRejected: true,
          grantsUnchanged: true,
          sourcesUnchanged: true,
          realPdf: true,
          offlineHtml: offlineDetails,
          externalRequests,
          desktopInputTested: false,
        },
        null,
        2,
      ),
    );
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    clearTimeout(watchdog);
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await writeFile(
      path.join(output, 'report.json'),
      JSON.stringify({ passed: false, everVisible, error: String(error.stack) }, null, 2),
    );
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await store?.dispose();
    clearTimeout(watchdog);
    app.exit(1);
  });
