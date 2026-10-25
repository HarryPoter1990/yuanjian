import './workflow-app.jsx';

const state = window.workflowFixture;
state.transferItems = [];
state.transferredNames = [];
state.attachments = [];
state.encodingRequests = [];
state.transferPending = false;
state.releaseTransfer = null;
state.encodedText = '姓名;说明\n甲;"中文,内容"';
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
