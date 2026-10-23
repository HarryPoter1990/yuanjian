import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import App from '../../src/App';
import { defaultSettings } from '../../src/shared/defaults';

// All notes and desktop operations live only in this page's memory.
const settings = structuredClone(defaultSettings);
settings.autoSave = false;
if (location.search.includes('toolbar-hidden')) settings.toolbarVisible = false;
let source = '# 自建交互验收\n\n| 项目 | 值 |\n| --- | --- |\n| 旧值 | 内容 |\n\n结束。';
if (location.search.includes('crlf')) source = source.replaceAll('\n', '\r\n');
const tab = {
  id: 'D:/generated-audit/中文 笔记.md',
  path: 'D:/generated-audit/中文 笔记.md',
  title: '自建交互验收',
  content: source,
  baseContent: source,
  hash: 'initial',
  modifiedAt: 1,
  dirty: false,
  cursor: source.length,
  scrollTop: 0,
  mode: 'live',
};
const state = {
  stored: structuredClone(tab),
  saved: [],
  session: null,
  settings: structuredClone(settings),
  closed: false,
  closeRequested: null,
  document: () =>
    EditorView.findFromDOM(document.querySelector('.cm-content')).state.doc.toString(),
};
window.auditFixture = state;
const api = {
  bootstrap: async () => ({
    settings,
    session: { tabs: [tab], activeId: tab.id },
    fonts: [],
    dataDirectory: 'memory-only',
    version: 'interaction-fixture',
  }),
  openFile: async () => structuredClone(state.stored),
  getWindowMode: async () => ({ mode: 'full', pinned: false }),
  setWindowMode: async (mode) => ({ mode, pinned: false }),
  setStickyPinned: async (pinned) => ({ mode: 'sticky', pinned }),
  onWindowModeChanged: () => () => {},
  setWindowTheme: async () => {},
  saveSettings: async (value) => {
    if (location.search.includes('settings-fail')) throw Error('自建设置写入失败');
    state.settings = structuredClone(value);
    return structuredClone(value);
  },
  saveSession: async (value) => {
    state.session = structuredClone(value);
  },
  saveFile: async (request) => {
    state.saved.push(structuredClone(request));
    state.stored = {
      ...state.stored,
      content: request.content,
      hash: `saved-${state.saved.length}`,
    };
    return { status: 'saved', note: structuredClone(state.stored) };
  },
  getTree: async () => [],
  getIndex: async () => [],
  getFontCatalog: async () => [],
  getFonts: async () => [],
  assetUrl: async () => '',
  onFilesChanged: () => () => {},
  onProgress: () => () => {},
  onOpenRequested: () => () => {},
  onCloseRequested: (callback) => {
    state.closeRequested = callback;
    return () => {};
  },
  closeReady: async () => {
    state.closed = true;
  },
};
window.notes = new Proxy(api, {
  get(target, key) {
    if (key in target) return target[key];
    throw Error(`Unprovided test desktop API: ${String(key)}`);
  },
});
createRoot(document.getElementById('root')).render(<App />);
