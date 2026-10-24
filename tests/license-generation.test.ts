import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve('scripts/licenses.mjs');
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(extra: Record<string, object> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-notices-'));
  directories.push(directory);
  await mkdir(path.join(directory, 'public', 'icons'), { recursive: true });
  await writeFile(path.join(directory, 'public', 'icons', 'LICENSE.txt'), 'generated icon license');
  await mkdir(path.join(directory, 'node_modules', 'present'), { recursive: true });
  await writeFile(
    path.join(directory, 'node_modules', 'present', 'package.json'),
    JSON.stringify({ name: 'present', version: '1.0.0', license: 'MIT' }),
  );
  await writeFile(
    path.join(directory, 'node_modules', 'present', 'LICENSE'),
    'generated runtime license text',
  );
  await writeFile(
    path.join(directory, 'package-lock.json'),
    JSON.stringify({
      packages: {
        '': { name: 'fixture' },
        'node_modules/present': { version: '1.0.0' },
        ...extra,
      },
    }),
  );
  return directory;
}
function run(cwd: string) {
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', windowsHide: true });
}
describe('runtime notice generation', () => {
  it('fails clearly when a required runtime package is missing', async () => {
    const directory = await fixture({ 'node_modules/required-missing': { version: '1.0.0' } });
    const result = run(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('required-missing');
  });
  it('reports absent optional packages explicitly while retaining installed license text', async () => {
    const directory = await fixture({
      'node_modules/platform-optional': { version: '1.0.0', optional: true },
      'node_modules/build-only': { version: '1.0.0', dev: true },
    });
    const result = run(directory);
    expect(result.status).toBe(0);
    const text = await readFile(
      path.join(directory, 'dist/licenses/THIRD-PARTY-NOTICES.txt'),
      'utf8',
    );
    expect(text).toContain('generated runtime license text');
    expect(text).toContain('platform-optional');
    expect(text).not.toContain('build-only');
  });
  it('does not treat an SPDX declaration alone as bundled license text', async () => {
    const directory = await fixture();
    await rm(path.join(directory, 'node_modules/present/LICENSE'));
    const result = run(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/present.*(?:license|许可)|(?:license|许可).*present/i);
  });
  it('rejects an installed version that differs from the audited lock entry', async () => {
    const directory = await fixture({ 'node_modules/present': { version: '2.0.0' } });
    const result = run(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('present');
  });
});
