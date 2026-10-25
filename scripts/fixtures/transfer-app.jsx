import './workflow-app.jsx';
import { EditorView } from '@codemirror/view';

const state = window.workflowFixture;
state.transferItems = [];
state.transferredNames = [];
state.attachments = [];
state.encodingRequests = [];
state.transferPending = false;
state.releaseTransfer = null;
state.encodedText = '姓名;说明\n甲;"中文,内容"';
state.formattedCopies = [];
state.editor = () => EditorView.findFromDOM(document.querySelector('.cm-content'));
state.setSource = (text) => {
  const view = state.editor();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
  });
  view.focus();
};
Object.assign(navigator.clipboard, {
  write: async (items) => {
    for (const item of items)
      state.formattedCopies.push({
        plain: await (await item.getType('text/plain')).text(),
        html: await (await item.getType('text/html')).text(),
      });
  },
});
Object.assign(window.notes, {
  prepareFiles: async (files) => {
    state.transferredNames.push(files.map((file) => file.name));
    if (state.transferPending)
      await new Promise((resolve) => {
        state.releaseTransfer = resolve;
      });
    return structuredClone(state.transferItems);
  },
  chooseImports: async () => structuredClone(state.transferItems),
  readImport: async (id, encoding) => {
    state.encodingRequests.push({ id, encoding });
    if (state.encodingFailure) throw Error('生成编码错误，原文件保留');
    const source = state.transferItems.find((item) => item.kind === 'source').source;
    return { ...source, encoding, text: state.encodedText };
  },
  importAssetUrl: async () =>
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xkAAAAASUVORK5CYII=',
  putAttachment: async (notePath, name, bytes) => {
    state.attachments.push({ notePath, name, byteLength: bytes.length });
    return { path: `D:/generated-workflow/assets/${name}`, reference: `assets/${name}` };
  },
});
