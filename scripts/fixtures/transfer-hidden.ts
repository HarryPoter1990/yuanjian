import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain } from 'electron';
import { NoteStore } from '../../electron/storage/store';
import { TransferService } from '../../electron/resources/import';
import { argumentSchemas } from '../../electron/validation';

const [fixture, report] = process.argv.slice(2);
assert.ok(path.resolve(fixture).startsWith(path.resolve('.test-data') + path.sep));
assert.ok(path.resolve(report).startsWith(path.resolve('artifacts') + path.sep));
const isolated = path.join(fixture, randomUUID());
app.setPath('userData', path.join(isolated, 'profile'));
app.setPath('sessionData', path.join(isolated, 'profile'));
app.setPath('logs', path.join(isolated, 'logs'));
let window: BrowserWindow | undefined;
let store: NoteStore | undefined;
let everVisible = false;
const watchdog = setTimeout(() => app.exit(2), 25000);
app
  .whenReady()
  .then(async () => {
    const source = path.join(isolated, 'source');
    const destination = path.join(isolated, 'destination', '导入.md');
    await mkdir(source, { recursive: true });
    await mkdir(path.dirname(destination));
    const markdown = path.join(source, '原文件.md');
    const html = path.join(source, '回答.html');
    const picture = path.join(source, 'picture.png');
    const noteBytes = Buffer.from('\ufeff# 原始笔记\r\n\r\n保持原文件。\r\n');
    const htmlBytes = Buffer.from(
      '<h1>导入标题</h1><img src="picture.png"><!-- <img src="secret.png"> -->',
    );
    const imageBytes = Buffer.from('generated-image-fixture');
    await writeFile(markdown, noteBytes);
    await writeFile(html, htmlBytes);
    await writeFile(picture, imageBytes);
    await writeFile(path.join(source, 'secret.png'), 'generated-private');
    let service: TransferService;
    store = new NoteStore(path.join(isolated, 'data'), {
      saveFile: async () => destination,
      prepareSave: (request, target) => service.prepareSave(request, target),
    });
    await store.initialize();
    service = new TransferService(store, { chooseFiles: async () => [] });
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.resolve('dist-electron/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    window.on('show', () => {
      everVisible = true;
      window?.destroy();
      app.exit(1);
    });
    const calls: string[] = [];
    const methods = {
      prepareFiles: (paths: string[]) => service.preparePaths(paths),
      readImport: (id: string, encoding: 'utf-8') => service.readImport(id, encoding),
      importAssetUrl: (id: string, reference: string) => service.resolveAsset(id, reference),
      saveFile: store.saveFile.bind(store),
    };
    for (const method of ['prepareFiles', 'readImport', 'importAssetUrl', 'saveFile'] as const) {
      ipcMain.handle(`notes:${method}`, (event, ...raw) => {
        assert.equal(event.sender, window!.webContents);
        assert.equal(event.senderFrame?.routingId, window!.webContents.mainFrame.routingId);
        const args = argumentSchemas[method].parse(raw);
        calls.push(method);
        return Reflect.apply(methods[method], undefined, args);
      });
    }
    const page = path.join(isolated, 'input.html');
    await writeFile(
      page,
      '<!doctype html><meta charset="utf-8"><input id="files" type="file" multiple>',
    );
    await window.loadFile(page);
    const debuggerAPI = window.webContents.debugger;
    debuggerAPI.attach('1.3');
    const { root } = await debuggerAPI.sendCommand('DOM.getDocument');
    const { nodeId } = await debuggerAPI.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#files',
    });
    await debuggerAPI.sendCommand('DOM.setFileInputFiles', { nodeId, files: [markdown, html] });
    const details = await window.webContents.executeJavaScript(`(async()=>{
    const assert=(condition,message)=>{if(!condition)throw Error(message)};
    const results=await notes.prepareFiles([...document.querySelector('#files').files]);
    assert(results[0].kind==='note'&&results[0].note.content.includes('保持原文件'),'Native note did not open');
    assert(results[1].kind==='source'&&results[1].source.format==='html','Native HTML did not become source');
    const source=results[1].source;
    const fake=new File(['forged'], 'forged.md');
    const forged=await notes.prepareFiles([fake]);
    assert(forged[0].kind==='error','Constructed File acquired disk identity');
    const decoded=await notes.readImport(source.id,'utf-8');
    assert(decoded.text.includes('导入标题'),'Source read failed');
    await notes.importAssetUrl(source.id,'picture.png');
    let rejected=false;try{await notes.importAssetUrl(source.id,'secret.png')}catch{rejected=true}
    assert(rejected,'Comment-only image acquired file authority');
    const outcome=await notes.saveFile({path:null,title:'导入',content:'# 导入标题\\n\\n![图片](picture.png)',baseContent:'',hash:'',importSourceId:source.id});
    assert(outcome.status==='saved'&&outcome.note.content.includes('assets/picture.png'),'Imported asset was not rewritten on save');
    return {nativeFilesOpened:2,constructedFileRejected:true,sourceReferenceRejected:rejected,saveStatus:outcome.status,isolated:crossOriginIsolated,sandboxedPreload:true};
  })()`);
    assert.equal(calls.filter((method) => method === 'prepareFiles').length, 1);
    assert.deepEqual(await readFile(markdown), noteBytes);
    assert.deepEqual(await readFile(html), htmlBytes);
    assert.deepEqual(
      await readFile(path.join(path.dirname(destination), 'assets', 'picture.png')),
      imageBytes,
    );
    assert.equal(window.isVisible(), false);
    await store.dispose();
    await writeFile(
      report,
      JSON.stringify(
        {
          passed: true,
          everVisible,
          desktopInputTested: false,
          ...details,
          originalNoteSHA256: createHash('sha256').update(noteBytes).digest('hex'),
          originalHTMLUnchanged: true,
        },
        null,
        2,
      ),
    );
    window.destroy();
    clearTimeout(watchdog);
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await writeFile(
      report,
      JSON.stringify({ passed: false, everVisible, message: String(error.stack) }, null, 2),
    );
    window?.destroy();
    clearTimeout(watchdog);
    app.exit(1);
  });
