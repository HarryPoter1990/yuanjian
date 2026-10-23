// Own hidden Electron fixture only: no visible window, input simulation, or user data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import electron from 'electron';

if (process.platform !== 'win32') throw new Error('Native sticky hit checks require Windows');
const fixture = path.resolve('.test-data/sticky-native-hit');
const report = path.resolve('artifacts/sticky-native-hit/report.json');
await mkdir(fixture, { recursive: true });
await mkdir(path.dirname(report), { recursive: true });
const bundle = await build({
  stdin: {
    contents: `
      import {createRoot} from 'react-dom/client';
      import {StickyHeader} from './src/components/StickyHeader';
      const note={id:'fixture',title:'便笺原生命中验收：长标题需要正常省略',path:null};
      const noop=()=>{};
      createRoot(document.getElementById('root')).render(
        <div className="app" data-theme="light" data-window-mode="sticky">
          <div className="sticky-header-host">
            <StickyHeader active={note} tabs={[note]} pinned={true} pending={false}
              saving={false} onSelect={noop} onPin={noop} onFull={noop} actions={[]} />
          </div>
          <main id="native-fixture-body" className="editor-column" contentEditable
            suppressContentEditableWarning>独立夹具正文，不使用用户笔记。</main>
        </div>
      );
      window.fixtureReady=true;
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
});
await writeFile(path.join(fixture, 'fixture.js'), bundle.outputFiles[0].text);
await writeFile(
  path.join(fixture, 'fixture.css'),
  (
    await Promise.all(
      ['src/styles/app.css', 'src/styles/icons.css'].map((file) => readFile(file, 'utf8')),
    )
  ).join('\n'),
);
await writeFile(
  path.join(fixture, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script>window.fixtureErrors=[];window.addEventListener("error",event=>window.fixtureErrors.push(event.message));</script><script src="fixture.js"></script></body></html>',
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(
    electron,
    [path.resolve('scripts/fixtures/sticky-native-hit.cjs'), fixture, report],
    { windowsHide: true, env: environment, stdio: 'inherit' },
  );
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`Hidden Electron fixture exited ${code}`)),
  );
});
const result = JSON.parse(await readFile(report, 'utf8'));
assert.equal(result.checked, true);
assert.equal(result.actualMouseDragTested, false);
console.log(JSON.stringify(result));
