import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import App from '../../src/App';
import { defaultSettings } from '../../src/shared/defaults';
import { parseNote } from '../../src/shared/markdown';
import { searchDocument, sortSearchNotes } from '../../src/shared/search';

// Generated documents only. Session storage belongs to this isolated test origin.
const directory = 'D:/generated-workflow';
const settings = { ...structuredClone(defaultSettings), autoSave: false, roots: [directory] };
Object.assign(settings, JSON.parse(sessionStorage.getItem('workflow-settings') || '{}'));
const makeNote = (name) => {
  const content = `# ${name}\n\n${name} 第一段。\n\n## 第二节\n\n${'练习内容。\n\n'.repeat(35)}结束。`;
  return {
    id: `${directory}/${name}.md`,
    path: `${directory}/${name}.md`,
    title: name,
    content,
    hash: `initial-${name}`,
    modifiedAt: 1,
    baseContent: content,
    dirty: false,
    cursor: content.length,
    scrollTop: 0,
    mode: 'live',
  };
};
const documents = Object.fromEntries(
  ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name) => {
    const note = makeNote(name);
    return [note.path, note];
  }),
);
for (const [title, content] of [
  ['Links', '# Links\n\n前 $x$ 后 **目标** 与 [网站](https://example.org/path)\n\n尾段。'],
  ['Table', '# Table\n\n| A | B |\n| --- | --- |\n| 旧 |\n\n尾段。'],
  ['Footnotes', '# 脚注样例\n\n正文[^注]\n\n尾段。\n\n[^注]: 注释正文\n'],
]) {
  const note = { ...makeNote(title), content, baseContent: content, cursor: content.length };
  documents[note.path] = note;
}
const initial = [documents[`${directory}/Alpha.md`], documents[`${directory}/Beta.md`]];
const nested = {
  ...makeNote('Nested'),
  id: `${directory}/Parent/Child/Nested.md`,
  path: `${directory}/Parent/Child/Nested.md`,
};
documents[nested.path] = nested;
let mode = { mode: 'full', pinned: false };
const state = {
  session: JSON.parse(sessionStorage.getItem('workflow-session') || 'null'),
  saved: [],
  opened: [],
  centered: 0,
  nextPath: `${directory}/Gamma.md`,
  failNextSave: false,
  openRequested: null,
  modes: [],
  copied: [],
  revealed: [],
  missingApi: [],
  clipboardText: '剪贴板纯文字',
  clipboardHtml: '<p>剪贴板<strong>富文本</strong></p>',
  document: () =>
    EditorView.findFromDOM(document.querySelector('.cm-content'))?.state.doc.toString(),
  cursor: () =>
    EditorView.findFromDOM(document.querySelector('.cm-content'))?.state.selection.main.head,
};
window.workflowFixture = state;
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: async (text) => {
      state.copied.push(text);
    },
    readText: async () => state.clipboardText,
    read: async () => [
      {
        types: ['text/plain', 'text/html'],
        getType: async (type) =>
          new Blob([type === 'text/html' ? state.clipboardHtml : state.clipboardText], { type }),
      },
    ],
  },
});
const api = {
  pendingHistory: async () => [],
  retryHistoryWork: async () => {},
  searchNotes: async (query, options) => ({
    notes: sortSearchNotes(
      Object.values(documents)
        .filter((note) => !options?.root || note.path.startsWith(options.root + '/'))
        .map((note) => searchDocument(query, { ...note, tags: [] }))
        .filter(Boolean),
    ),
    issues: [],
    truncated: false,
  }),
  cancelSearch: async () => {},
  bootstrap: async () => ({
    settings: structuredClone(settings),
    session: structuredClone(state.session || { tabs: initial, activeId: initial[0].id }),
    fonts: [],
    dataDirectory: 'memory-only',
    version: 'workflow-fixture',
  }),
  getIndex: async () =>
    Object.values(documents).map((note) => parseNote(note.content, note.path, 1)),
  getTree: async () => [
    ...Object.values(documents)
      .filter((note) => note.path !== nested.path)
      .map((note) => ({
        path: note.path,
        name: `${note.title}.md`,
        kind: 'note',
      })),
    {
      path: `${directory}/Parent`,
      name: 'Parent',
      kind: 'directory',
      children: [
        {
          path: `${directory}/Parent/Child`,
          name: 'Child',
          kind: 'directory',
          children: [{ path: nested.path, name: 'Nested.md', kind: 'note' }],
        },
      ],
    },
  ],
  resolveLink: async (fromPath, target) => {
    if (/^https?:\/\//i.test(target))
      return { path: null, exists: true, candidates: [], external: target };
    const url = new URL(target, `file:///${fromPath}`);
    const path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1');
    return {
      path,
      exists: Boolean(documents[path]),
      candidates: [],
      heading: url.hash.slice(1) || undefined,
    };
  },
  saveSettings: async (value) => {
    sessionStorage.setItem('workflow-settings', JSON.stringify(value));
    return value;
  },
  saveSession: async (value) => {
    state.session = structuredClone(value);
    sessionStorage.setItem('workflow-session', JSON.stringify(value));
  },
  openFile: async (path) => {
    const target = path || state.nextPath;
    state.opened.push(target);
    if (!documents[target]) throw Error('Generated file not found');
    return structuredClone(documents[target]);
  },
  saveFile: async (request) => {
    if (state.failNextSave) {
      state.failNextSave = false;
      throw Error('自建写入失败，文件保留');
    }
    const path = request.path || `${directory}/SavedDraft.md`;
    const note = {
      ...(documents[path] || makeNote('SavedDraft')),
      id: path,
      path,
      content: request.content,
      hash: `saved-${state.saved.length}`,
      modifiedAt: 2,
    };
    documents[path] = note;
    state.saved.push(structuredClone(request));
    return { status: 'saved', note: structuredClone(note) };
  },
  centerWindow: async () => {
    state.centered++;
  },
  getWindowMode: async () => mode,
  setWindowMode: async (next) => {
    mode = { mode: next, pinned: next === 'sticky' };
    state.modes.push(next);
    return mode;
  },
  setStickyPinned: async (pinned) => {
    mode = { ...mode, pinned };
    return mode;
  },
  setWindowTheme: async () => {},
  onOpenRequested: (callback) => {
    state.openRequested = callback;
    return () => {};
  },
  onWindowModeChanged: () => () => {},
  onCloseRequested: () => () => {},
  onFilesChanged: () => () => {},
  onProgress: () => () => {},
  getFontCatalog: async () => [],
  getFonts: async () => [],
  assetUrl: async () => '',
  revealPath: async (path) => {
    state.revealed.push(path);
  },
  openExternal: async (target) => {
    state.opened.push(target);
  },
};
window.notes = new Proxy(api, {
  get(target, key) {
    if (key in target) return target[key];
    state.missingApi.push(String(key));
    throw Error(`Unprovided workflow desktop API: ${String(key)}`);
  },
});
createRoot(document.getElementById('root')).render(<App />);
