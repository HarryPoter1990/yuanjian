interface ClipboardReader {
  read?(): Promise<readonly ClipboardItem[]>;
  readText(): Promise<string>;
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

export async function readClipboardContent(clipboard: ClipboardReader, plainOnly = false) {
  const empty = { html: '', plain: '', files: [] as File[], notices: [] as string[] };
  if (plainOnly) return { ...empty, plain: await clipboard.readText() };
  try {
    if (typeof clipboard.read !== 'function') throw new Error('富文本读取不可用');
    const items = await clipboard.read();
    const html: string[] = [],
      plain: string[] = [],
      files: File[] = [];
    for (const item of items) {
      if (item.types.includes('text/html'))
        html.push(await blobText(await item.getType('text/html')));
      if (item.types.includes('text/plain'))
        plain.push(await blobText(await item.getType('text/plain')));
      const image =
        item.types.find((type) => type === 'image/png') ??
        item.types.find((type) => type.startsWith('image/'));
      if (image) {
        const extension = image.split('/')[1].split('+')[0].replace('jpeg', 'jpg');
        files.push(
          new File([await item.getType(image)], `剪贴板图片-${files.length + 1}.${extension}`, {
            type: image,
          }),
        );
      }
    }
    return { html: html.join('\n'), plain: plain.join('\n'), files, notices: [] as string[] };
  } catch {
    try {
      return {
        ...empty,
        plain: await clipboard.readText(),
        notices: ['无法读取富文本剪贴板，已改为纯文字粘贴；格式与图片未读取。'],
      };
    } catch {
      throw new Error('无法读取剪贴板，请按 Ctrl+V 或 Ctrl+Shift+V 重试；正文未修改。');
    }
  }
}
