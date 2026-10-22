import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../src/shared/types';

// Fixed methods, never expose arbitrary ipcRenderer.send/invoke to rendered Markdown.
// https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations
const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('notes:bootstrap'),
  saveSettings: (value) => ipcRenderer.invoke('notes:saveSettings', value),
  saveSession: (value) => ipcRenderer.invoke('notes:saveSession', value),
  openFile: (value) => ipcRenderer.invoke('notes:openFile', value),
  saveFile: (value) => ipcRenderer.invoke('notes:saveFile', value),
  selectDirectory: () => ipcRenderer.invoke('notes:selectDirectory'),
  getTree: (value) => ipcRenderer.invoke('notes:getTree', value),
  getIndex: () => ipcRenderer.invoke('notes:getIndex'),
  search: (query, options) => ipcRenderer.invoke('notes:search', query, options),
  resolveLink: (from, target) => ipcRenderer.invoke('notes:resolveLink', from, target),
  moveFile: (from, to) => ipcRenderer.invoke('notes:moveFile', from, to),
  undoMove: (id) => ipcRenderer.invoke('notes:undoMove', id),
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
