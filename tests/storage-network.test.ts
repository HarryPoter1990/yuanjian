import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

const sandboxes: string[] = [];
afterEach(async () => {
  for (const directory of sandboxes.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(fetchImage: typeof fetch) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-network-'));
  sandboxes.push(sandbox);
  const root = path.join(sandbox, '笔记');
  await mkdir(root);
  const file = path.join(root, '网络.md');
  const content = '![网络图](https://example.invalid/image.png)';
  await writeFile(file, content);
  const store = new NoteStore(path.join(sandbox, 'data'), { fetch: fetchImage });
  await store.initialize();
  await store.approveDirectory(root);
  return { store, file, content };
}
describe('explicit image downloads', () => {
  it('preserves ordinary links and shared reference definitions while localizing image usages only', async () => {
    const { store, file } = await fixture(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const url = 'https://example.invalid/shared.png';
    const definition = `[shared]: ${url} "保留标题"`;
    const content = `![行内图片](${url})\n[普通链接](${url})\n\n![引用图片][shared]\n![shared][]\n![shared]\n[普通引用][shared]\n\n${definition}\n\n网址：${url}\n\n\`![代码图片](${url})\``;
    const result = await store.localizeImages(file, content);
    expect(result.results).toHaveLength(1);
    expect(result.content).toContain(`[普通链接](${url})`);
    expect(result.content).toContain('[普通引用][shared]');
    expect(result.content).toContain(definition);
    expect(result.content).toContain(`网址：${url}`);
    expect(result.content).toContain(`\`![代码图片](${url})\``);
    expect(result.content).toMatch(/!\[行内图片\]\(assets\//);
    expect(result.content).toMatch(/!\[引用图片\]\(assets\/[^)]+ "保留标题"\)/);
    expect(result.content).toMatch(/!\[shared\]\(assets\/[^)]+\)/);
    expect(result.content).not.toContain('![shared][]');
    await store.dispose();
  });
  it('localizes only selected URLs that already occur as images in the current Markdown', async () => {
    const { store, file } = await fixture(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const first = 'https://example.invalid/first.png';
    const second = 'https://example.invalid/second.png';
    const content = `![一](${first})\n\n![二](${second})`;
    const selected = await store.localizeImages(file, content, [second]);
    expect(selected.results.map((result) => result.url)).toEqual([second]);
    expect(selected.content).toContain(`![一](${first})`);
    expect(selected.content).not.toContain(`![二](${second})`);
    const absent = await store.localizeImages(file, content, [
      'https://unselected.invalid/private.png',
    ]);
    expect(absent.results).toEqual([]);
    expect(absent.content).toBe(content);
    await store.dispose();
  });
  it('refuses over-limit images before consuming the body and preserves the Markdown URL', async () => {
    const { store, file, content } = await fixture(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: { 'content-type': 'image/png', 'content-length': String(30 * 1024 * 1024) },
        }),
    );
    const result = await store.localizeImages(file, content);
    expect(result.content).toBe(content);
    expect(result.results[0].error).toContain('25 MiB');
    expect(await readFile(file, 'utf8')).toBe(content);
    await store.dispose();
  });
  it('does not follow a redirect to a file URL', async () => {
    const { store, file, content } = await fixture(
      async () =>
        new Response(null, { status: 302, headers: { location: 'file:///private/image.png' } }),
    );
    const result = await store.localizeImages(file, content);
    expect(result.content).toBe(content);
    expect(result.results[0].error).toContain('HTTP(S)');
    await store.dispose();
  });
  it('reports unsupported content types and cancelled open/save without claiming success', async () => {
    const { store, file, content } = await fixture(
      async () =>
        new Response('<html>not an image</html>', { headers: { 'content-type': 'text/html' } }),
    );
    const result = await store.localizeImages(file, content);
    expect(result.results[0].error).toContain('类型');
    expect(result.content).toBe(content);
    expect(await store.openFile()).toBeNull();
    expect(
      await store.saveFile({
        path: null,
        content: '草稿',
        baseContent: '',
        hash: '',
        title: '草稿',
      }),
    ).toEqual({ status: 'cancelled' });
    await store.dispose();
  });
});
