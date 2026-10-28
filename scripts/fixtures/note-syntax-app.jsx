import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import App from '../../src/App';
import { defaultSettings } from '../../src/shared/defaults';
import { parseNote } from '../../src/shared/markdown';
import { resolveFixtureAsset } from '../../src/editor/prototype-fixtures';
import { inlineCodeSample } from './inline-code-sample';
import '../../src/styles/app.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource/jetbrains-mono';

const directory = 'D:/generated-note-integration';
const rootPath = `${directory}/root.md`,
  childPath = `${directory}/sub/child.md`,
  otherPath = `${directory}/sub/other.md`;
const parameters = new URLSearchParams(location.search);
const inlineRegression = parameters.get('visual') === 'inline-code';
const source = inlineRegression
  ? inlineCodeSample
  : '# 工作区笔记\n\n[TOC]\n\n普通正文与 **加粗文字**，还有 [示例网站](https://example.com)。\n\n> [!info] 学习提示\n> ==保留重点==，H~2~O 与 x^2^。\n\n> [!warning]- 可折叠提示\n> 这里是折叠内容。\n\n## 定义\n\n接口定义这一段。 ^home\n\n[[#^home|回到定义]]，也可查看 [[sub/child.md#^definition|子笔记]]。\n\n![[sub/child.md#定义]]\n\n![[sub/other.md]]\n\n公式 $x+1$，解释见脚注[^注]。\n\n[^注]: 补充解释。\n\n%%隐藏备注，不应导出%%\n\n<details>\n<summary>课后补充</summary>\n\n补充内容。\n\n</details>\n\n| 名称 | 说明 |\n| --- | --- |\n| 第一项 | 可编辑 |\n\n```js\nconst value = 1;\n```\n\n继续写作。';
const note = (path, title, content) => ({
  id: path,
  path,
  title,
  content,
  baseContent: content,
  dirty: false,
  hash: `initial-${title}`,
  modifiedAt: 1,
  cursor: content.length,
  scrollTop: 0,
  mode: 'live',
});
const root = note(
  rootPath,
  '主笔记',
  source.replace('普通正文与 **加粗文字**', '普通正文与 `users` 和 **加粗文字**') +
    (parameters.has('code-block')
      ? '\n\n```js\n// 待办示例\nconst title = "学习";\nlet done = false;\n```'
      : ''),
);
const child = note(
  childPath,
  '子笔记',
  '# 定义\n\n磁盘旧定义。 ^definition\n\n![子图](images/child.png)\n\n[后续参考](other.md)',
);
const other = note(otherPath, '外部引用', '# 参考\n\n磁盘参考内容。');
const documents = new Map([root, child, other].map((item) => [item.path, structuredClone(item)]));
const openChild = {
  ...child,
  content: child.content.replace('磁盘旧定义', '未保存的新定义'),
  dirty: true,
};
const settings = { ...structuredClone(defaultSettings), autoSave: false, roots: [directory] };
if (inlineRegression) {
  settings.appearance.mode = parameters.get('mode') || 'dark';
  settings.appearance.palette = parameters.get('palette') || 'neutral';
  settings.appearance.paletteByMode = {
    light: settings.appearance.palette,
    dark: settings.appearance.palette,
  };
  if (parameters.get('wallpaper') === 'true') {
    settings.appearance.wallpaper = 'generated-wallpaper';
    settings.appearance.wallpaperOpacity = 0.9;
    settings.appearance.editorOpacity = 0.65;
  }
  settings.leftVisible = false;
  settings.rightVisible = false;
}
let mode = { mode: 'full', pinned: false },
  filesChanged;
const image = resolveFixtureAsset('学习流程.png');
const fixture = {
  exports: [],
  reads: [],
  assets: [],
  saved: [],
  navigations: [],
  copies: [],
  unknown: [],
  session: null,
  view: () => EditorView.findFromDOM(document.querySelector('.cm-content')),
  state: () => {
    const view = fixture.view();
    return {
      source: view.state.doc.toString(),
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
    };
  },
  changeReference: () => {
    const target = documents.get(otherPath);
    target.content = '# 参考\n\n磁盘参考已经更新。';
    target.modifiedAt++;
    filesChanged?.([otherPath]);
  },
};
window.noteIntegration = fixture;
const resolve = (from, target) => {
  const [file, heading] = target.split('#', 2);
  if (!file) return { path: from, heading, exists: true, candidates: [from] };
  const raw = decodeURIComponent(file).replaceAll('\\', '/');
  const destination = /^[a-z]:\//i.test(raw)
    ? raw
    : new URL(raw, `file:///${from}`).pathname.slice(1);
  const path = documents.has(destination)
    ? destination
    : destination.endsWith('.md')
      ? destination
      : destination + '.md';
  return {
    path: documents.has(path) ? path : null,
    heading,
    exists: documents.has(path),
    candidates: documents.has(path) ? [path] : [],
  };
};
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    write: async (items) => {
      const item = items[0];
      fixture.copies.push({
        plain: await (await item.getType('text/plain')).text(),
        html: await (await item.getType('text/html')).text(),
      });
    },
    writeText: async (plain) => fixture.copies.push({ plain }),
  },
});
const api = {
  bootstrap: async () => ({
    settings,
    session: { tabs: [root, openChild], activeId: root.id },
    fonts: [],
    dataDirectory: 'generated-memory-only',
    version: 'integration-check',
  }),
  pendingHistory: async () => [],
  getFontCatalog: async () => [],
  getFonts: async () => [],
  getIndex: async () =>
    [...documents.values()].map((item) => parseNote(item.content, item.path, item.modifiedAt)),
  getTree: async () =>
    [...documents.values()].map((item) => ({
      path: item.path,
      name: item.title + '.md',
      kind: 'note',
    })),
  getWindowMode: async () => mode,
  setWindowMode: async (next) => (mode = { ...mode, mode: next }),
  setStickyPinned: async (pinned) => (mode = { mode: 'sticky', pinned }),
  setWindowTheme: async () => {},
  centerWindow: async () => {},
  saveSettings: async (value) => {
    Object.assign(settings, value);
    return structuredClone(settings);
  },
  saveSession: async (session) => (fixture.session = structuredClone(session)),
  saveFile: async (request) => {
    fixture.saved.push(structuredClone(request));
    const updated = {
      ...documents.get(request.path),
      content: request.content,
      hash: 'saved-' + fixture.saved.length,
      modifiedAt: Date.now(),
    };
    documents.set(request.path, updated);
    return { status: 'saved', note: structuredClone(updated) };
  },
  openFile: async (path) => structuredClone(documents.get(path ?? rootPath)),
  openLinkedFile: async (from, target) => {
    const result = resolve(from, target);
    return result.path ? structuredClone(documents.get(result.path)) : null;
  },
  resolveLink: async (from, target) => {
    fixture.navigations.push({ from, target });
    return resolve(from, target);
  },
  readEmbeddedNote: async (from, target) => {
    fixture.reads.push({ from, target });
    const result = resolve(from, target);
    return result.path
      ? { path: result.path, source: documents.get(result.path).content }
      : { error: '生成夹具中目标不存在或未授权' };
  },
  assetUrl: async (reference, from) => {
    fixture.assets.push({ reference, from });
    return image;
  },
  exportDocument: async (request) => {
    fixture.exports.push(structuredClone(request));
    return `${directory}/export.${request.format}`;
  },
  openExternal: async (target) => (fixture.lastExternal = target),
  onFilesChanged: (callback) => {
    filesChanged = callback;
    return () => (filesChanged = null);
  },
  onWindowModeChanged: () => () => {},
  onProgress: () => () => {},
  onOpenRequested: () => () => {},
  onCloseRequested: () => () => {},
};
window.notes = new Proxy(api, {
  get(target, key) {
    if (key in target) return target[key];
    fixture.unknown.push(String(key));
    throw Error(`Unexpected integration API: ${String(key)}`);
  },
});
createRoot(document.getElementById('root')).render(<App />);
