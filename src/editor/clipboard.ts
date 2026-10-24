import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export function richTextToMarkdown(html: string, plainText = ''): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['annotation'],
    ADD_ATTR: ['encoding'],
  });
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  turndown.use(gfm);
  turndown.addRule('latex', {
    filter: (element) =>
      element.tagName.toLowerCase() === 'math' ||
      element.hasAttribute('data-latex') ||
      element.classList.contains('katex'),
    replacement: (content, node) => {
      const element = node instanceof Element ? node : null;
      const source =
        element?.getAttribute('data-latex') ??
        element?.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (!source) return content;
      const display =
        element?.getAttribute('display') === 'block' ||
        element?.parentElement?.classList.contains('katex-display');
      return display ? `\n\n$$\n${source}\n$$\n\n` : `$${source}$`;
    },
  });
  try {
    const converted = turndown.turndown(clean).trim();
    return converted || plainText;
  } catch {
    return plainText;
  }
}

function dataBytes(source: string): Uint8Array | null {
  const match = /^data:image\/[^,]+,(.*)$/is.exec(source);
  if (!match) return null;
  try {
    const value = /;base64,/i.test(source)
      ? atob(match[1].replace(/\s/g, ''))
      : decodeURIComponent(match[1]);
    return Uint8Array.from(value, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function referenceName(source: string): string {
  const identifier = source.replace(/^cid:/i, '');
  // A URL basename does not prove that a clipboard file contains those remote image bytes.
  if (/[:/\\?#]/.test(identifier)) return '';
  try {
    return decodeURIComponent(identifier).split('@')[0].toLowerCase();
  } catch {
    return '';
  }
}

export async function compoundClipboardToMarkdown(
  html: string,
  plainText: string,
  files: File[],
  importImage: (file: File) => Promise<string | null>,
): Promise<{ markdown: string; notices: string[] }> {
  const body = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['annotation'],
    ADD_ATTR: ['encoding'],
    RETURN_DOM: true,
  });
  if (!(body instanceof HTMLElement))
    return { markdown: plainText, notices: ['富文本无法完整转换，已保留纯文字。'] };
  const images = [...body.querySelectorAll('img')];
  const originalSources = new Map(images.map((image) => [image, image.getAttribute('src') ?? '']));
  const used = new Set<File>();
  const notices = new Set<string>();
  const imported = new Map<File, Promise<string | null>>();
  const bytes = new Map<File, Promise<Uint8Array | null>>();
  const fileBytes = (file: File) => {
    if (!bytes.has(file))
      bytes.set(
        file,
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(typeof reader.result === 'string' ? dataBytes(reader.result) : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        }),
      );
    return bytes.get(file)!;
  };
  const importOnce = (file: File) => {
    if (!imported.has(file))
      imported.set(
        file,
        importImage(file)
          .then((reference) => {
            if (!reference) notices.add(`${file.name} 未导入，文字已保留。`);
            return reference;
          })
          .catch((reason: unknown) => {
            notices.add(
              `${file.name} 导入失败：${reason instanceof Error ? reason.message : String(reason)}；文字已保留。`,
            );
            return null;
          }),
      );
    return imported.get(file)!;
  };
  let unresolvedUsableImage = false;
  for (const image of images) {
    const source = originalSources.get(image)!;
    const name = referenceName(source);
    let file =
      name &&
      files.filter((file) => file.name.toLowerCase() === name).length === 1 &&
      new Set(
        images
          .filter((candidate) => referenceName(originalSources.get(candidate)!) === name)
          .map((candidate) => originalSources.get(candidate)),
      ).size === 1
        ? files.find((file) => file.name.toLowerCase() === name)
        : undefined;
    const data = dataBytes(source);
    if (!file && data) {
      for (const candidate of files) {
        const value = await fileBytes(candidate);
        if (
          value &&
          value.length === data.length &&
          value.every((byte, index) => byte === data[index])
        ) {
          file ??= candidate;
          used.add(candidate);
        }
      }
    }
    if (file) {
      used.add(file);
      const reference = await importOnce(file);
      if (reference) image.setAttribute('src', reference);
      else
        image.replaceWith(
          body.ownerDocument.createTextNode(`[图片未导入：${image.alt || file.name}]`),
        );
    } else if (/^(?:https?:|data:image\/(?:png|jpe?g|gif|webp|avif);)/i.test(source)) {
      unresolvedUsableImage = true;
    } else {
      image.replaceWith(
        body.ownerDocument.createTextNode(`[图片未导入：${image.alt || '剪贴板图片'}]`),
      );
      notices.add('部分图片地址无法与文件可靠对应，原有文字和图片说明已保留。');
    }
  }
  const appended: string[] = [];
  const remaining = files.filter((file) => !used.has(file));
  if (remaining.length && unresolvedUsableImage) {
    notices.add(
      '剪贴板原有图片引用已保留；另带图像文件无法确认对应关系，未重复添加，未全部本地化。',
    );
  } else {
    for (const file of remaining) {
      const reference = await importOnce(file);
      if (!reference) continue;
      const name = file.name.replace(/[\[\]\\]/g, '') || '图片';
      const destination = /[\s()]/.test(reference)
        ? `<${reference.replace(/>/g, '%3E')}>`
        : reference;
      appended.push(`![${name}](${destination})`);
    }
    if (appended.length && (html || plainText))
      notices.add('部分图片的位置无法确认，已放在文字之后。');
  }
  const text = richTextToMarkdown(body.innerHTML, plainText);
  return { markdown: [text, ...appended].filter(Boolean).join('\n\n'), notices: [...notices] };
}
