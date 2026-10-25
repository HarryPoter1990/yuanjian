interface ClipboardReader {
  read?(): Promise<readonly ClipboardItem[]>;
  readText(): Promise<string>;
}
export interface ClipboardPart {
  html: string;
  plain: string;
  files: File[];
}

function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('无法读取剪贴板文字'));
    reader.readAsText(blob);
  });
}

export async function readClipboardContent(
  clipboard: ClipboardReader,
  plainOnly = false,
): Promise<{ items: ClipboardPart[]; notices: string[] }> {
  const textPart = (plain: string): ClipboardPart => ({ html: '', plain, files: [] });
  if (plainOnly) return { items: [textPart(await clipboard.readText())], notices: [] };
  try {
    if (typeof clipboard.read !== 'function') throw new Error('富文本读取不可用');
    const values = await clipboard.read();
    const items: ClipboardPart[] = [],
      notices: string[] = [];
    for (const [index, item] of values.entries()) {
      const part = textPart('');
      const read = async (type: string): Promise<Blob | null> => {
        try {
          return await item.getType(type);
        } catch {
          notices.push(
            `剪贴板第 ${index + 1} 项的 ${type} 未能读取，已保留该项可读取的内容及其他项。`,
          );
          return null;
        }
      };
      for (const [type, field] of [
        ['text/html', 'html'],
        ['text/plain', 'plain'],
      ] as const) {
        if (!item.types.includes(type)) continue;
        const blob = await read(type);
        if (blob) {
          try {
            part[field] = await blobText(blob);
          } catch {
            notices.push(`剪贴板第 ${index + 1} 项的 ${type} 文字读取失败，其他可读内容已保留。`);
          }
        }
      }
      const image =
        item.types.find((type) => type === 'image/png') ??
        item.types.find((type) => type.startsWith('image/'));
      if (image) {
        const extension = image.split('/')[1].split('+')[0].replace('jpeg', 'jpg');
        const blob = await read(image);
        if (blob)
          part.files.push(
            new File([blob], `剪贴板图片-${index + 1}.${extension}`, {
              type: image,
            }),
          );
      }
      items.push(part);
    }
    return { items, notices };
  } catch {
    try {
      return {
        items: [textPart(await clipboard.readText())],
        notices: ['无法读取富文本剪贴板，已改为纯文字粘贴；格式与图片未读取。'],
      };
    } catch {
      throw new Error('无法读取剪贴板，请按 Ctrl+V 或 Ctrl+Shift+V 重试；正文未修改。');
    }
  }
}
