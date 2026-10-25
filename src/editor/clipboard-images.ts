import type { ClipboardPart } from './clipboard-reader';

// Keep copied HTML bounded; normal attachment storage can independently accept larger files.
const SINGLE_IMAGE_LIMIT = 8 * 1024 * 1024;
const TOTAL_IMAGE_LIMIT = 24 * 1024 * 1024;
const raster = /^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon)$/i;
const missing = (image: HTMLImageElement) => `[图片未携带：${image.alt || '本地图'}]`;

async function imageBlob(response: Response, available: number): Promise<Blob> {
  if (!response.ok) throw Error('本地图片读取失败');
  const type = response.headers.get('content-type')?.split(';')[0] ?? '';
  if (!raster.test(type)) throw Error('该图片格式无法安全携带到剪贴板');
  const limit = Math.min(SINGLE_IMAGE_LIMIT, available);
  if (Number(response.headers.get('content-length')) > limit)
    throw Error('图片超过剪贴板携带大小限制');
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (blob.size > limit) throw Error('图片超过剪贴板携带大小限制');
    return blob;
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw Error('图片超过剪贴板携带大小限制');
      chunks.push(Uint8Array.from(next.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return new Blob(chunks, { type });
}
const dataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('图片编码失败'));
    reader.readAsDataURL(blob);
  });

export async function inlineClipboardImages(
  html: string,
  resolveAsset?: (reference: string) => Promise<string>,
): Promise<{ html: string; notices: string[] }> {
  const root = document.createElement('template');
  root.innerHTML = html;
  const notices: string[] = [];
  let total = 0;
  const resolved = new Map<string, Promise<Blob>>();
  for (const image of root.content.querySelectorAll('img')) {
    const reference = image.getAttribute('src') ?? '';
    if (/^(?:https?:)?\/\//i.test(reference)) continue;
    try {
      if (/^data:image\//i.test(reference)) {
        const match = /^data:(image\/[a-z0-9+.-]+);base64,([a-z0-9+/=\s]*)$/i.exec(reference);
        if (!match || !raster.test(match[1])) throw Error('该图片数据格式无法安全携带');
        const size = (match[2].replace(/\s/g, '').length * 3) / 4;
        if (size > SINGLE_IMAGE_LIMIT || total + size > TOTAL_IMAGE_LIMIT)
          throw Error('图片超过剪贴板携带大小限制');
        total += size;
        continue;
      }
      if (!reference || !resolveAsset) throw Error('没有可用的本地图片来源');
      if (!resolved.has(reference))
        resolved.set(
          reference,
          (async () => {
            const url = await resolveAsset(reference);
            if (!/^note-asset:/i.test(url)) throw Error('本地图片来源无法确认');
            return imageBlob(
              await fetch(url, { credentials: 'omit', redirect: 'error' }),
              TOTAL_IMAGE_LIMIT - total,
            );
          })(),
        );
      const blob = await resolved.get(reference)!;
      total += blob.size;
      if (total > TOTAL_IMAGE_LIMIT) throw Error('图片合计超过剪贴板携带大小限制');
      image.setAttribute('src', await dataUrl(blob));
    } catch (error) {
      notices.push(
        `${image.alt || reference || '图片'} 未携带：${error instanceof Error ? error.message : String(error)}；其他文字已保留。`,
      );
      image.replaceWith(document.createTextNode(missing(image)));
    }
  }
  return { html: root.innerHTML, notices };
}

export function embeddedClipboardImages(part: ClipboardPart): {
  part: ClipboardPart;
  notices: string[];
} {
  if (!part.html) return { part, notices: [] };
  const root = document.createElement('template');
  root.innerHTML = part.html;
  const files = [...part.files],
    notices: string[] = [];
  let total = 0;
  for (const image of root.content.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? '';
    if (!/^data:/i.test(source)) continue;
    try {
      const match = /^data:(image\/[a-z0-9+.-]+);base64,([a-z0-9+/=\s]*)$/i.exec(source);
      if (!match || !raster.test(match[1])) throw Error('图片数据格式无法安全导入');
      if ((match[2].length * 3) / 4 > SINGLE_IMAGE_LIMIT + 2)
        throw Error('图片超过剪贴板导入大小限制');
      const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), (value) =>
        value.charCodeAt(0),
      );
      total += bytes.length;
      if (total > TOTAL_IMAGE_LIMIT) throw Error('图片合计超过剪贴板导入大小限制');
      const extension = match[1].split('/')[1].replace('jpeg', 'jpg').replace('x-icon', 'ico');
      files.push(
        new File([bytes], `剪贴板内嵌图片-${files.length + 1}.${extension}`, { type: match[1] }),
      );
    } catch (error) {
      image.replaceWith(document.createTextNode(missing(image)));
      notices.push(
        `内嵌图片未导入：${error instanceof Error ? error.message : String(error)}；文字与其他图片已保留。`,
      );
    }
  }
  return { part: { ...part, html: root.innerHTML, files }, notices };
}
