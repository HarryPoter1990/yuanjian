const path = require('node:path');
const { unlink, writeFile, stat } = require('node:fs/promises');
const asar = require('@electron/asar');

module.exports = async (context) => {
  const project = path.resolve(__dirname, '..');
  const out = path.resolve(context.appOutDir);
  const relative = path.relative(path.join(project, 'release'), out);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Unexpected package output directory');
  await unlink(path.join(out, 'resources', 'default_app.asar')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  const archive = path.join(out, 'resources', 'app.asar');
  const files = asar
    .listPackage(archive)
    .map((file) => file.replace(/\\/g, '/').replace(/^\//, ''));
  const extra = files.filter(
    (file) =>
      !['dist', 'dist-electron', 'package.json'].includes(file) &&
      !file.startsWith('dist/') &&
      !file.startsWith('dist-electron/'),
  );
  if (extra.length) throw new Error(`Unexpected packaged files: ${extra.slice(0, 10).join(', ')}`);
  for (const name of [
    'dist/index.html',
    'dist-electron/main.cjs',
    'dist-electron/preload.cjs',
    'dist/licenses/THIRD-PARTY-NOTICES.txt',
  ]) {
    if (!files.includes(name)) throw new Error(`Packaged app missing ${name}`);
  }
  for (const file of files.filter((name) => /\.(?:js|cjs|css|html|json)$/.test(name))) {
    const content = asar.extractFile(archive, path.normalize(file)).toString('utf8');
    if (/C:[\\/]+Users[\\/]+USER|codex-clipboard-|sk-proj-[a-zA-Z0-9]{12}/i.test(content))
      throw new Error(`Personal data or credential pattern in ${file}`);
  }
  const fontBytes = files
    .filter((file) => /\.(?:woff2?|ttf|otf)$/.test(file))
    .reduce((total, file) => total + asar.statFile(archive, path.normalize(file)).size, 0);
  await writeFile(
    path.join(project, 'artifacts/package-audit.json'),
    JSON.stringify(
      {
        fileCount: files.length,
        archiveBytes: (await stat(archive)).size,
        fontBytes,
        extra,
        files,
      },
      null,
      2,
    ),
  );
};
