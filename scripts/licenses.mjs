import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = [
  '鸢笺 / Yuanjian — third-party software and font notices',
  'Bundled runtime components retain their respective licenses. Electron/Chromium licenses are also distributed beside the executable.',
];
notices.push(
  `Fluent System Icons — https://github.com/microsoft/fluentui-system-icons\n${await readFile('public/icons/LICENSE.txt', 'utf8')}`,
);
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev) continue;
  let names;
  try {
    names = await readdir(location);
  } catch (error) {
    if (metadata.optional && error.code === 'ENOENT') {
      notices.push(
        `Optional dependency absent from this installation: ${location}@${metadata.version || 'unknown'}`,
      );
      continue;
    }
    throw new Error(`Required runtime license source is unavailable: ${location}`, {
      cause: error,
    });
  }
  const manifest = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
  if (metadata.version && manifest.version !== metadata.version)
    throw new Error(
      `Runtime version differs from package-lock.json: ${location} (${manifest.version} != ${metadata.version})`,
    );
  notices.push(
    `\n${'='.repeat(72)}\n${manifest.name}@${manifest.version}\nLicense: ${manifest.license || 'See upstream package'}\n${manifest.homepage || manifest.repository?.url || ''}`,
  );
  let included = 0;
  for (const name of names.filter((name) =>
    /^(?:licen[cs]e|copying|ofl)(?:[._-].*)?$/i.test(name),
  )) {
    try {
      const text = await readFile(path.join(location, name), 'utf8');
      if (text.trim()) {
        notices.push(`--- ${name} ---\n${text}`);
        included++;
      }
    } catch (error) {
      if (error.code !== 'EISDIR') throw error;
    }
  }
  if (!included)
    throw new Error(
      `Runtime license text missing: ${location}; a license declaration alone is insufficient for this notice`,
    );
}
await mkdir('dist/licenses', { recursive: true });
await writeFile('dist/licenses/THIRD-PARTY-NOTICES.txt', notices.join('\n\n'), 'utf8');
