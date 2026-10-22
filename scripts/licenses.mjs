import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = [
  '鸢笺 / Yuanjian — third-party software and font notices',
  'Bundled runtime components retain their respective licenses. Electron/Chromium licenses are also distributed beside the executable.',
];
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev) continue;
  let names;
  try {
    names = await readdir(location);
  } catch {
    continue;
  }
  const manifest = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
  notices.push(
    `\n${'='.repeat(72)}\n${manifest.name}@${manifest.version}\nLicense: ${manifest.license || 'See upstream package'}\n${manifest.homepage || manifest.repository?.url || ''}`,
  );
  for (const name of names.filter((name) =>
    /^(?:licen[cs]e|copying|ofl)(?:[._-].*)?$/i.test(name),
  )) {
    try {
      notices.push(`--- ${name} ---\n${await readFile(path.join(location, name), 'utf8')}`);
    } catch (error) {
      if (error.code !== 'EISDIR') throw error;
    }
  }
}
await mkdir('dist/licenses', { recursive: true });
await writeFile('dist/licenses/THIRD-PARTY-NOTICES.txt', notices.join('\n\n'), 'utf8');
