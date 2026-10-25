// Exercise the shipped preload with native File objects, without a visible window or clipboard.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';

const fixture = path.resolve('.test-data/transfer-hidden');
const report = path.resolve('artifacts/transfer-hidden/report.json');
await mkdir(fixture, { recursive: true });
await mkdir(path.dirname(report), { recursive: true });
await build({
  entryPoints: ['scripts/fixtures/transfer-hidden.ts'],
  outfile: path.join(fixture, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(electron, [path.join(fixture, 'main.cjs'), fixture, report], {
    windowsHide: true,
    env: environment,
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(Error(`Hidden transfer check exited ${code}`)),
  );
});
const result = JSON.parse(await readFile(report, 'utf8'));
assert.equal(result.passed, true);
assert.equal(result.everVisible, false);
console.log(JSON.stringify(result));
