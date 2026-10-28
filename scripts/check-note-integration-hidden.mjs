// Real shipped preload, storage boundary and export manager in an always-hidden Electron process.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
const electron = process.env.YUANJIAN_TEST_ELECTRON || (await import('electron')).default;
const fixture = path.resolve('.test-data/note-integration-hidden');
const output = path.resolve('artifacts/integration-2026-10-28/native');
const source = path.resolve(process.argv[2] || 'artifacts/integration-2026-10-28/browser');
assert.ok(source.startsWith(path.resolve('artifacts') + path.sep));
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: ['scripts/fixtures/note-integration-hidden.ts'],
  outfile: path.join(fixture, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(electron, [path.join(fixture, 'main.cjs'), fixture, output, source], {
    windowsHide: true,
    env: environment,
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(Error(`Hidden note integration check exited ${code}`)),
  );
});
const result = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
assert.equal(result.passed, true);
assert.equal(result.everVisible, false);
console.log(JSON.stringify(result, null, 2));
