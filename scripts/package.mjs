import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const project = process.cwd();
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, { recursive: true });
const staging = await mkdtemp(path.join(artifacts, 'package-app-'));
async function copyDirectory(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDirectory(source, target);
    else if (entry.isFile()) await copyFile(source, target);
    else throw new Error(`Packaging refuses links: ${entry.name}`);
  }
}
for (const directory of ['dist', 'dist-electron'])
  await copyDirectory(path.join(project, directory), path.join(staging, directory));
// Both entrypoints bundle runtime dependencies; the staging manifest deliberately has no node_modules.
await writeFile(
  path.join(staging, 'package.json'),
  JSON.stringify(
    {
      name: metadata.name,
      productName: metadata.productName,
      version: metadata.version,
      private: true,
      description: metadata.description,
      author: metadata.author,
      main: metadata.main,
    },
    null,
    2,
  ),
);
const configuration = {
  ...metadata.build,
  beforeBuild: path.join(project, 'scripts/before-build.cjs'),
  afterPack: path.join(project, 'scripts/after-pack.cjs'),
  electronVersion: metadata.devDependencies.electron,
  electronDist: process.env.ELECTRON_OVERRIDE_DIST_PATH
    ? path.resolve(process.env.ELECTRON_OVERRIDE_DIST_PATH)
    : path.join(project, 'node_modules/electron/dist'),
  win: { ...metadata.build.win, icon: path.join(project, 'build/icon.ico') },
  directories: {
    app: staging,
    output: path.join(project, 'release'),
    buildResources: path.join(project, 'build'),
  },
};
const configPath = path.join(staging, 'builder-config.json');
await writeFile(configPath, JSON.stringify(configuration, null, 2));
await writeFile(path.join(artifacts, 'latest-package-stage.txt'), staging);
const child = spawn(
  process.execPath,
  [
    path.join(project, 'node_modules/electron-builder/cli.js'),
    '--config',
    configPath,
    '--win',
    'nsis',
    '--x64',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      ELECTRON_BUILDER_CACHE: path.join(artifacts, 'builder-cache'),
    },
    windowsHide: true,
  },
);
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
process.exitCode = code ?? 1;
