import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../electron/storage/store';
import { TransferService } from '../electron/resources/import';
let root: string, store: NoteStore, service: TransferService;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-import-auth-'));
  await mkdir(path.join(root, 'source'));
  store = new NoteStore(path.join(root, 'data'));
  await store.initialize();
  service = new TransferService(store, { chooseFiles: async () => [] });
  await writeFile(path.join(root, 'source', 'secret.png'), 'generated-private-bytes');
});
afterEach(async () => {
  await store.dispose();
  await rm(root, { recursive: true, force: true });
});
it.each([
  '<script>const example = \'<img src="secret.png">\';</script><p>Visible text</p>',
  '<!-- <img src="secret.png"> --><p>Visible text</p>',
  '<div title=\'<img src="secret.png">\'>Visible text</div>',
  '<img data-src="secret.png">',
])('does not authorize images that exist only in inert source text: %s', async (html) => {
  const file = path.join(root, 'source', 'index.html');
  await writeFile(file, html);
  const prepared = (await service.preparePaths([file]))[0];
  if (prepared.kind !== 'source') throw Error('Expected generated HTML source');
  await expect(service.resolveAsset(prepared.source.id, 'secret.png')).rejects.toThrow();
});
it('allows a real image source attribute', async () => {
  const file = path.join(root, 'source', 'index.html');
  await writeFile(file, '<img src="secret.png">');
  const prepared = (await service.preparePaths([file]))[0];
  if (prepared.kind !== 'source') throw Error('Expected generated HTML source');
  expect(await service.resolveAsset(prepared.source.id, 'secret.png')).toBe(
    path.join(root, 'source', 'secret.png'),
  );
});
