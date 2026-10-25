// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { embeddedClipboardImages, inlineClipboardImages } from '../src/editor/clipboard-images';
afterEach(() => vi.unstubAllGlobals());
it('embeds only resolved local note assets and leaves remote images without fetching them', async () => {
  const resolve = vi.fn(async () => 'note-asset://generated/image');
  const fetcher = vi.fn(async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'image/png' }),
    blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
  }));
  vi.stubGlobal('fetch', fetcher);
  const result = await inlineClipboardImages(
    '<p>前<img src="assets/p.png" alt="本地">后<img src="https://example.invalid/remote.png"></p>',
    resolve,
  );
  expect(result.html).toContain('data:image/png;base64,aW1hZ2UtYnl0ZXM=');
  expect(result.html).toContain('https://example.invalid/remote.png');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(resolve).toHaveBeenCalledWith('assets/p.png');
  expect(result.notices).toEqual([]);
});
it('does not follow an asset resolver to HTTP and preserves surrounding text with a notice', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const result = await inlineClipboardImages(
    '<p>前<img src="assets/unknown.png" alt="示意图">后</p>',
    async () => 'https://example.invalid/forged',
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.html).toContain('前[图片未携带：示意图]后');
  expect(result.notices.join(' ')).toContain('来源无法确认');
});
it('refuses oversized local image data while retaining other content', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(9 * 1024 * 1024),
      }),
    })),
  );
  const result = await inlineClipboardImages(
    '<p>文字<img src="assets/large.png" alt="大图"></p>',
    async () => 'note-asset://generated/image',
  );
  expect(result.html).toContain('文字');
  expect(result.html).not.toContain('<img');
  expect(result.notices.join(' ')).toContain('大小限制');
});
it('turns an HTML-only data image into a File for the existing target attachment import path', async () => {
  const result = embeddedClipboardImages({
    html: '<p>前<img src="data:image/png;base64,eA==">后</p>',
    plain: '前后',
    files: [],
  });
  expect(result.part.files).toHaveLength(1);
  expect(result.part.files[0].type).toBe('image/png');
  expect(result.part.files[0].size).toBe(1);
  expect(result.notices).toEqual([]);
  expect(result.part.html).toContain('data:image/png;base64,eA==');
});
it('rejects unsupported embedded formats without losing their nearby text', () => {
  const result = embeddedClipboardImages({
    html: '<p>前<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="矢量图">后</p>',
    plain: '',
    files: [],
  });
  expect(result.part.files).toEqual([]);
  expect(result.part.html).toContain('前[图片未携带：矢量图]后');
  expect(result.notices.join(' ')).toContain('无法安全导入');
});
