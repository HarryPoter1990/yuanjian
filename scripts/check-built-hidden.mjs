// Load the real packaged renderer through file:// in an always-hidden, isolated Electron window.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';
const fixture = path.resolve('.test-data/built-hidden');
const report = path.resolve('artifacts/built-hidden/report.json');
await mkdir(fixture, { recursive: true });
await mkdir(path.dirname(report), { recursive: true });
const preload = await build({
  stdin: {
    contents: `
  import {contextBridge} from 'electron';
  import {defaultSettings} from './src/shared/defaults';
  const content='# 隔离产物检查\\n\\n生成内容。';
  const tab={id:'generated-A',path:'D:/generated-built/A.md',title:'隔离产物检查',content,baseContent:content,hash:'a',modifiedAt:1,dirty:false,cursor:content.length,scrollTop:0,mode:'live'};
  let settings={...defaultSettings,autoSave:false};
  contextBridge.exposeInMainWorld('notes',{
    bootstrap:async()=>({settings,session:{tabs:[tab],activeId:tab.id},fonts:[
      {id:'sans',name:'Noto Sans SC Variable',source:'bundled'},
      {id:'inter',name:'Inter Variable',source:'bundled'},
      {id:'system-generated',name:'Generated System Font',source:'system'}
    ],dataDirectory:'isolated-memory',version:'built-hidden'}),
    getFontCatalog:async()=>[],
    getIndex:async()=>['A','B'].map(name=>({path:'D:/generated-built/'+name+'.md',title:name,tags:[],links:[],headings:[],modifiedAt:1})),
    getTree:async()=>[],saveSession:async()=>{},saveSettings:async value=>{settings=structuredClone(value);return structuredClone(settings);},
    getWindowMode:async()=>({mode:'full',pinned:false}),setWindowTheme:async()=>{},
    onWindowModeChanged:()=>()=>{},onFilesChanged:()=>()=>{},onProgress:()=>()=>{},onOpenRequested:()=>()=>{},onCloseRequested:()=>()=>{}
  });`,
    resolveDir: process.cwd(),
    loader: 'js',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['electron'],
});
await writeFile(path.join(fixture, 'preload.cjs'), preload.outputFiles[0].text);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(
    electron,
    [
      path.resolve('scripts/fixtures/built-hidden.cjs'),
      fixture,
      path.resolve('dist/index.html'),
      report,
    ],
    { windowsHide: true, env: environment, stdio: 'inherit' },
  );
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(Error(`Hidden renderer check exited ${code}`)),
  );
});
const result = JSON.parse(await readFile(report, 'utf8'));
assert.equal(result.passed, true);
assert.equal(result.everVisible, false);
console.log(JSON.stringify(result));
