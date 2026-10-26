import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI, TransferItem } from '../src/shared/types';

// Fixed methods, never expose arbitrary ipcRenderer.send/invoke to rendered Markdown.
// https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations
const api: DesktopAPI = {
  prepareFiles: async (files) => {
    if (!Array.isArray(files) || files.length > 100) throw new Error('一次最多处理 100 个文件');
    const candidates = files.map((file) => {
      try {
        const path = webUtils.getPathForFile(file);
        if (!path) throw new Error('没有可读取的磁盘文件身份');
        return { path };
      } catch {
        return {
          error: {
            kind: 'error' as const,
            name: file?.name || '未知文件',
            message: '无法识别此磁盘文件，请使用导入文件选择框。',
          },
        };
      }
    });
    const paths = candidates.flatMap((item) => (item.path ? [item.path] : []));
    const prepared: TransferItem[] = paths.length
      ? await ipcRenderer.invoke('notes:prepareFiles', paths)
      : [];
    let next = 0;
    return candidates.map(
      (item) =>
        item.error ??
        prepared[next++] ?? { kind: 'error', name: '文件', message: '文件处理未返回结果。' },
    );
  },
  chooseImports: () => ipcRenderer.invoke('notes:chooseImports'),
  readImport: (id, encoding) => ipcRenderer.invoke('notes:readImport', id, encoding),
  importAssetUrl: (id, reference) => ipcRenderer.invoke('notes:importAssetUrl', id, reference),
  getWindowMode: () => ipcRenderer.invoke('notes:getWindowMode'),
  centerWindow: () => ipcRenderer.invoke('notes:centerWindow'),
  setWindowMode: (mode) => ipcRenderer.invoke('notes:setWindowMode', mode),
  setStickyPinned: (pinned) => ipcRenderer.invoke('notes:setStickyPinned', pinned),
  onWindowModeChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) =>
      callback(state);
    ipcRenderer.on('notes:window-mode-changed', listener);
    return () => ipcRenderer.removeListener('notes:window-mode-changed', listener);
  },
  bootstrap: () => ipcRenderer.invoke('notes:bootstrap'),
  setWindowTheme: (theme) => ipcRenderer.invoke('notes:setWindowTheme', theme),
  saveSettings: (value) => ipcRenderer.invoke('notes:saveSettings', value),
  saveSession: (value) => ipcRenderer.invoke('notes:saveSession', value),
  openFile: (value) => ipcRenderer.invoke('notes:openFile', value),
  openLinkedFile: (from, target) => ipcRenderer.invoke('notes:openLinkedFile', from, target),
  saveFile: (value) => ipcRenderer.invoke('notes:saveFile', value),
  selectDirectory: () => ipcRenderer.invoke('notes:selectDirectory'),
  getTree: (value) => ipcRenderer.invoke('notes:getTree', value),
  getIndex: () => ipcRenderer.invoke('notes:getIndex'),
  search: (query, options) => ipcRenderer.invoke('notes:search', query, options),
  resolveLink: (from, target) => ipcRenderer.invoke('notes:resolveLink', from, target),
  moveFile: (from, to) => ipcRenderer.invoke('notes:moveFile', from, to),
  undoMove: (id) => ipcRenderer.invoke('notes:undoMove', id),
  retryMoveHistory: (id) => ipcRenderer.invoke('notes:retryMoveHistory', id),
  pendingHistory: () => ipcRenderer.invoke('notes:pendingHistory'),
  retryHistoryWork: (id) => ipcRenderer.invoke('notes:retryHistoryWork', id),
  trashFile: (file) => ipcRenderer.invoke('notes:trashFile', file),
  setTags: (file, tags) => ipcRenderer.invoke('notes:setTags', file, tags),
  putAttachment: (file, name, bytes) =>
    ipcRenderer.invoke('notes:putAttachment', file, name, bytes),
  assetUrl: (file, from) => ipcRenderer.invoke('notes:assetUrl', file, from),
  localizeImages: (file, content, urls) =>
    ipcRenderer.invoke('notes:localizeImages', file, content, urls),
  scanAttachments: () => ipcRenderer.invoke('notes:scanAttachments'),
  trashAttachments: (files) => ipcRenderer.invoke('notes:trashAttachments', files),
  listHistory: (file) => ipcRenderer.invoke('notes:listHistory', file),
  readHistory: (id) => ipcRenderer.invoke('notes:readHistory', id),
  restoreHistory: (id) => ipcRenderer.invoke('notes:restoreHistory', id),
  pinHistory: (id, pinned) => ipcRenderer.invoke('notes:pinHistory', id, pinned),
  historyStats: () => ipcRenderer.invoke('notes:historyStats'),
  pruneHistory: () => ipcRenderer.invoke('notes:pruneHistory'),
  periodicNote: (kind, date, template, additional) =>
    ipcRenderer.invoke('notes:periodicNote', kind, date, template, additional),
  getFonts: (refresh) => ipcRenderer.invoke('notes:getFonts', refresh),
  getFontCatalog: () => ipcRenderer.invoke('notes:getFontCatalog'),
  importFonts: () => ipcRenderer.invoke('notes:importFonts'),
  downloadFont: (id) => ipcRenderer.invoke('notes:downloadFont', id),
  removeFont: (id) => ipcRenderer.invoke('notes:removeFont', id),
  chooseWallpaper: () => ipcRenderer.invoke('notes:chooseWallpaper'),
  exportDocument: (value) => ipcRenderer.invoke('notes:exportDocument', value),
  exportBundle: (file, content) => ipcRenderer.invoke('notes:exportBundle', file, content),
  openExternal: (url) => ipcRenderer.invoke('notes:openExternal', url),
  revealPath: (file) => ipcRenderer.invoke('notes:revealPath', file),
  closeReady: () => ipcRenderer.invoke('notes:closeReady'),
  onFilesChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, files: string[]) => callback(files);
    ipcRenderer.on('notes:files-changed', listener);
    return () => ipcRenderer.removeListener('notes:files-changed', listener);
  },
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('notes:close-requested', listener);
    ipcRenderer.send('notes:ui-ready');
    return () => ipcRenderer.removeListener('notes:close-requested', listener);
  },
  onOpenRequested: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, file: string) => callback(file);
    ipcRenderer.on('notes:open-requested', listener);
    return () => ipcRenderer.removeListener('notes:open-requested', listener);
  },
  onProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof callback>[0],
    ) => callback(progress);
    ipcRenderer.on('notes:progress', listener);
    return () => ipcRenderer.removeListener('notes:progress', listener);
  },
};
contextBridge.exposeInMainWorld('notes', api);
