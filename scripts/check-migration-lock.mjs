// Hold an actual Windows exclusive file lock in a generated directory; never opens AppData.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

assert.equal(process.platform, 'win32', 'This check exercises Windows file sharing locks.');
const fixture = await mkdtemp(path.resolve('.test-data/migration-native-'));
assert.ok(fixture.startsWith(path.resolve('.test-data') + path.sep));
const reportDirectory = path.resolve('artifacts/migration-lock');
await mkdir(reportDirectory, { recursive: true });
await build({
  entryPoints: ['electron/resources/data-migration.ts'],
  outfile: path.join(fixture, 'migration.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { migrateDataDirectory, DATA_NAME, LEGACY_DATA_NAME } = createRequire(import.meta.url)(
  path.join(fixture, 'migration.cjs'),
);
const holder = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$heldFile = [System.IO.File]::Open($env:YUANJIAN_LOCK_FIXTURE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  [Console]::Out.WriteLine('LOCKED')
  [Console]::Out.Flush()
  [Console]::In.ReadLine() | Out-Null
} finally { $heldFile.Dispose() }
`;

async function lock(file) {
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', holder],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, YUANJIAN_LOCK_FIXTURE: file },
    },
  );
  let output = '',
    errors = '';
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill();
      reject(Error('Generated lock helper timed out'));
    }, 10000);
    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(deadline);
      reject(Error(`Lock helper exited ${code}: ${errors}`));
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('LOCKED')) {
        clearTimeout(deadline);
        resolve();
      }
    });
  });
  return async () => {
    child.stdin.end('release\n');
    const deadline = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(deadline);
  };
}

const results = [];
for (const [name, relative, shouldMigrate] of [
  [
    'locked-gpu-cache',
    ['GPUPersistentCache', 'DawnGraphiteCache', 'generated-cache-key', 'cache.db'],
    true,
  ],
  ['locked-user-data', ['MyCache', 'user-state.db'], false],
]) {
  const root = path.join(fixture, name),
    original = path.join(root, LEGACY_DATA_NAME),
    target = path.join(root, DATA_NAME);
  const file = path.join(original, ...relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'generated locked bytes');
  await writeFile(path.join(original, 'session.json'), 'generated draft');
  const release = await lock(file);
  try {
    await assert.rejects(readFile(file), (error) => error.code === 'EBUSY');
    const outcome = await migrateDataDirectory(root);
    assert.equal(outcome.migrated, shouldMigrate, JSON.stringify(outcome));
    assert.equal(outcome.directory, shouldMigrate ? target : original);
    assert.equal(await readFile(path.join(original, 'session.json'), 'utf8'), 'generated draft');
    if (shouldMigrate) {
      assert.equal(await readFile(path.join(target, 'session.json'), 'utf8'), 'generated draft');
      assert.ok(!(await readdir(target)).includes('GPUPersistentCache'));
    } else assert.deepEqual(await readdir(root), [LEGACY_DATA_NAME]);
    results.push({ name, passed: true, actualExclusiveLock: true, nodeReadError: 'EBUSY' });
  } catch (error) {
    results.push({ name, passed: false, message: String(error.stack) });
  } finally {
    await release();
  }
  assert.equal(await readFile(file, 'utf8'), 'generated locked bytes');
}
await writeFile(
  path.join(reportDirectory, 'report.json'),
  JSON.stringify({ realUserDataRead: false, fixture, results }, null, 2),
);
for (const result of results) console.log(JSON.stringify(result));
assert.ok(
  results.every((result) => result.passed),
  'Exclusive migration lock checks failed',
);
