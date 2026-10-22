import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chokidar, { type FSWatcher } from 'chokidar';
import { NoteStore } from './storage/store';
import { within } from './storage/access';
import { bundledFonts, FontManager, fontCatalog } from './resources/fonts';
import { ExportManager } from './resources/export';
import { argumentSchemas, type InvokeMethod } from './validation';
import type { Bootstrap, OperationProgress } from '../src/shared/types';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'note-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
const testMode = process.env.LOCAL_NOTES_TEST === '1';
const dataFlag = process.argv.find((argument) => argument.startsWith('--data-dir='));
if (testMode && dataFlag) {
  const candidate = path.resolve(dataFlag.slice('--data-dir='.length));
  const testRoot = path.resolve(
    app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
    '.test-data',
  );
  if (!within(testRoot, candidate)) throw new Error('测试数据目录必须在程序目录的 .test-data 内');
  app.setPath('userData', candidate);
}
app.setName('轻笺');
let window: BrowserWindow | null = null;
let store: NoteStore;
let watcher: FSWatcher | null = null;
let watchedKey = '';
let mayClose = false;
let uiReady = false;
const pendingOpenPaths: string[] = [];
function requestOpen(file: string) {
  if (uiReady) send('notes:open-requested', file);
  else pendingOpenPaths.push(file);
}
const assetFiles = new Map<string, string>();
const assetTokens = new Map<string, string>();
const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ttc': 'font/collection',
  '.otc': 'font/collection',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const buildDirectory = path.join(app.getAppPath(), 'dist');
const developmentUrl = process.env.VITE_DEV_SERVER_URL;
const mainUrl = developmentUrl
  ? new URL(developmentUrl).href
  : pathToFileURL(path.join(buildDirectory, 'index.html')).href;
const send = (channel: string, value?: unknown) => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
};
const progress = (value: OperationProgress) => send('notes:progress', value);

async function readAsset(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'note-asset:' || parsed.hostname !== 'asset')
    throw new Error('资源地址无效');
  const file = assetFiles.get(parsed.pathname.slice(1));
  if (!file) throw new Error('资源未授权');
  const checked = await store.authorize(file);
  const mime = mimeTypes[path.extname(checked).toLowerCase()];
  if (!mime || (await stat(checked)).size > 256 * 1024 * 1024)
    throw new Error('资源类型或大小不受支持');
  return { bytes: await readFile(checked), mime };
}
async function assetUrl(target: string, from?: string): Promise<string> {
  if (/^https?:\/\//i.test(target)) return new URL(target).href;
  const file = await store.resolveAssetPath(target, from);
  if (!mimeTypes[path.extname(file).toLowerCase()]) throw new Error('不是可显示的图片或字体');
  let token = assetTokens.get(file);
  if (!token) {
    token = randomUUID();
    assetTokens.set(file, token);
    assetFiles.set(token, file);
  }
  return `note-asset://asset/${token}`;
}
async function refreshWatcher() {
  const approved = store.getApprovedPaths();
  const files = [
    ...approved.directories,
    ...approved.files.filter((file) => /\.(?:md|markdown|mdown|mkd)$/i.test(file)),
  ].sort();
  const key = JSON.stringify({ files, excluded: store.getSettings().excluded });
  if (key === watchedKey) return;
  watchedKey = key;
  await watcher?.close();
  const roots = [...approved.directories].sort((a, b) => b.length - a.length);
  watcher = chokidar.watch(files, {
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 75 },
    ignored: (candidate) => {
      if (approved.files.includes(candidate)) return false;
      if (path.basename(candidate).endsWith('.tmp')) return true;
      const root = roots.find((directory) => within(directory, path.resolve(candidate)));
      if (!root) return false;
      return store.access.isExcluded(root, path.resolve(candidate));
    },
  });
  const changed = new Set<string>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  watcher.on('all', (_event, file) => {
    changed.add(file);
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      send('notes:files-changed', [...changed]);
      changed.clear();
    }, 180);
  });
  watcher.on('error', (error) =>
    progress({
      id: 'watcher',
      kind: 'error',
      completed: 0,
      message: `外部文件监视失败：${String(error)}`,
    }),
  );
}
async function chooseSave(suggested: string, format: 'html' | 'pdf' | 'zip' | 'md') {
  const safeName = path.basename(suggested).replace(/[<>:"|?*]/g, '-');
  const defaultPath = path.isAbsolute(suggested)
    ? path.join(path.dirname(suggested), safeName)
    : safeName;
  const result = await dialog.showSaveDialog(window!, {
    defaultPath,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return null;
  const file = path.extname(result.filePath) ? result.filePath : `${result.filePath}.${format}`;
  await store.approveFile(file);
  return file;
}
async function renderPdf(htmlFile: string, target: string): Promise<void> {
  // Export HTML has script-src/default-src 'none'; keep JS available only for this fixed readiness probe.
  const exportWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  exportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await exportWindow.loadFile(htmlFile);
    const failure: unknown = await exportWindow.webContents.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `Promise.race([
      Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.complete
        ? (image.naturalWidth ? Promise.resolve() : Promise.reject(new Error('图片加载失败，请先本地化网络图片后重试')))
        : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片加载失败，请先本地化网络图片后重试')); }))]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('导出资源加载超时，请先本地化网络图片后重试')), 25000))
    ]).then(() => null, error => String(error.message || error))`,
      },
    ]);
    if (failure) throw new Error(String(failure));
    const pdf = await exportWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    const { atomicWrite } = await import('./storage/io');
    await atomicWrite(target, pdf);
  } finally {
    exportWindow.destroy();
  }
}

async function boot() {
  const dataDirectory = app.getPath('userData');
  if (testMode && process.env.HTTPS_PROXY) {
    const proxy = new URL(process.env.HTTPS_PROXY);
    await session.defaultSession.setProxy({
      proxyRules: `${proxy.hostname}:${proxy.port || '80'}`,
    });
  }
  store = new NoteStore(dataDirectory, {
    openFile: async () => {
      const result = await dialog.showOpenDialog(window!, {
        properties: ['openFile'],
        filters: [{ name: 'Markdown 笔记', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    },
    saveFile: (suggested) => chooseSave(suggested, 'md'),
    selectDirectory: async () => {
      const result = await dialog.showOpenDialog(window!, {
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    },
    trash: (file) => shell.trashItem(file),
    changed: (files) => send('notes:files-changed', files),
    progress,
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
  });
  await store.initialize();
  const fonts = new FontManager(dataDirectory, {
    selectFiles: async () => {
      const result = await dialog.showOpenDialog(window!, {
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '字体或字体包',
            extensions: ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2', 'zip'],
          },
        ],
      });
      return result.canceled ? [] : result.filePaths;
    },
    assetUrl: async (file) => {
      await store.approveFile(file);
      return assetUrl(file);
    },
    progress,
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
  });
  const exporter = new ExportManager(store, {
    chooseSave,
    renderPdf,
    assetData: readAsset,
    buildDirectory,
    managedFonts: () => fonts.managedFonts(),
  });
  protocol.handle('note-asset', async (request) => {
    try {
      const asset = await readAsset(request.url);
      return new Response(Buffer.from(asset.bytes), {
        headers: {
          'Content-Type': asset.mime,
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('资源不存在或未授权', { status: 404 });
    }
  });
  const handlers = {
    bootstrap: async (): Promise<Bootstrap> => {
      let availableFonts = bundledFonts;
      const warnings: string[] = [];
      try {
        availableFonts = await fonts.getFonts();
      } catch (error) {
        warnings.push(
          `系统字体读取失败，可在设置中重试：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return {
        settings: store.getSettings(),
        session: store.getSession(),
        fonts: availableFonts,
        dataDirectory,
        version: app.getVersion(),
        warnings,
      };
    },
    assetUrl,
    getFonts: (refresh?: boolean) => fonts.getFonts(refresh),
    getFontCatalog: async () => fontCatalog,
    importFonts: () => fonts.importFonts(),
    downloadFont: (id: string) => fonts.downloadFont(id),
    removeFont: (id: string) => fonts.removeFont(id),
    chooseWallpaper: async () => {
      const result = await dialog.showOpenDialog(window!, {
        properties: ['openFile'],
        filters: [{ name: '静态壁纸', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return store.approveFile(result.filePaths[0]);
    },
    exportDocument: (request: Parameters<ExportManager['exportDocument']>[0]) =>
      exporter.exportDocument(request),
    exportBundle: (file: string, content: string) => exporter.exportBundle(file, content),
    openExternal: async (target: string) => {
      const url = new URL(target);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('只允许打开普通 HTTP(S) 网页');
      await shell.openExternal(url.href);
    },
    revealPath: async (file: string) => {
      const allowed =
        path.resolve(file) === path.resolve(dataDirectory)
          ? dataDirectory
          : await store.authorize(file);
      shell.showItemInFolder(allowed);
    },
    closeReady: async () => {
      await store.dispose();
      mayClose = true;
      window?.close();
    },
  };
  for (const method of Object.keys(argumentSchemas) as InvokeMethod[]) {
    ipcMain.handle(`notes:${method}`, async (event, ...raw: unknown[]) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame?.routingId !== window?.webContents.mainFrame.routingId ||
        event.senderFrame?.url.split('#')[0] !== mainUrl
      )
        throw new Error('无效的桌面请求来源');
      const args = argumentSchemas[method].parse(raw);
      const own = Reflect.get(handlers, method);
      const handler: unknown = own ?? Reflect.get(store, method);
      if (typeof handler !== 'function') throw new Error(`桌面功能未注册：${method}`);
      const result: unknown = await Reflect.apply(handler, own ? handlers : store, args);
      if (
        ['openFile', 'selectDirectory', 'saveSettings', 'saveFile', 'periodicNote'].includes(method)
      )
        await refreshWatcher();
      return result;
    });
  }
  ipcMain.on('notes:ui-ready', (event) => {
    if (
      event.sender !== window?.webContents ||
      event.senderFrame?.routingId !== window?.webContents.mainFrame.routingId
    )
      return;
    uiReady = true;
    for (const file of pendingOpenPaths.splice(0)) send('notes:open-requested', file);
  });
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#f6f5f1',
    title: '轻笺',
    icon: path.join(buildDirectory, 'app-icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== mainUrl) event.preventDefault();
  });
  window.once('ready-to-show', () => window?.show());
  window.on('close', (event) => {
    if (mayClose || !uiReady) return;
    event.preventDefault();
    send('notes:close-requested');
  });
  await window.loadURL(mainUrl);
  await refreshWatcher();
  const initialFile = process.argv.find(
    (value) => /\.(md|markdown|mdown|mkd)$/i.test(value) && !value.startsWith('--'),
  );
  if (initialFile) {
    await store.approveFile(path.resolve(initialFile));
    requestOpen(path.resolve(initialFile));
  }
}

const lock = testMode || app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', async (_event, argv) => {
    window?.show();
    if (window?.isMinimized()) window.restore();
    window?.focus();
    const file = argv.find((value) => /\.(md|markdown|mdown|mkd)$/i.test(value));
    if (file && store) {
      await store.approveFile(path.resolve(file));
      requestOpen(path.resolve(file));
    }
  });
  app
    .whenReady()
    .then(boot)
    .catch((error) => {
      dialog.showErrorBox('轻笺启动失败', error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
  app.on('window-all-closed', () => {
    void watcher?.close();
    app.quit();
  });
  app.on('before-quit', () => {
    void store?.dispose();
  });
}
