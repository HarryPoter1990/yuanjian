import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { markdownTableFromGrid, readHtmlTable, type HtmlTableGrid } from './html-table';

export function convertRichText(
  html: string,
  plainText = '',
  inTableCell = false,
): { markdown: string; notices: string[] } {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['annotation'],
    ADD_ATTR: ['encoding'],
  });
  const notices = new Set<string>();
  const createConverter = (inCell = false): TurndownService => {
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
    });
    turndown.use(gfm);
    // The plugin's row/cell rules cannot serialize multiline or headerless cells safely.
    turndown.addRule('clipboardTableParts', {
      filter: ['tr', 'td', 'th'],
      replacement: (content) => content,
    });
    turndown.addRule('clipboardTable', {
      filter: 'table',
      replacement: (_content, node) => {
        const table = node as HTMLTableElement;
        const grid = readHtmlTable(table, (cell) => createConverter(true).turndown(cell));
        grid.notices.forEach((notice) => notices.add(notice));
        if (!grid.hasHeader && grid.rows.length)
          notices.add('来源表格没有表头，已补空表头，首行仍保留为数据。');
        const caption = table.caption
          ? createConverter().turndown(table.caption.innerHTML).trim()
          : '';
        return (
          '\n\n' +
          [caption, markdownTableFromGrid(grid.rows, grid.hasHeader, grid.alignments)]
            .filter(Boolean)
            .join('\n\n') +
          '\n\n'
        );
      },
    });
    if (inCell) {
      turndown.addRule('clipboardCellBreak', { filter: 'br', replacement: () => '\n' });
      turndown.addRule('clipboardCellBlock', {
        filter: ['p', 'div'],
        replacement: (content) => '\n\n' + content + '\n\n',
      });
    }
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
          !inCell &&
          (element?.getAttribute('display') === 'block' ||
            element?.parentElement?.classList.contains('katex-display'));
        const math = inCell ? source.replace(/\r\n?|\n/g, ' ') : source;
        return display ? `\n\n$$\n${math}\n$$\n\n` : `$${math}$`;
      },
    });
    return turndown;
  };
  try {
    const converted = createConverter(inTableCell).turndown(clean).trim();
    return { markdown: converted || plainText, notices: [...notices] };
  } catch {
    const body = document.createElement('div');
    body.innerHTML = clean;
    return {
      markdown: plainText || body.textContent || '',
      notices: ['富文本无法完整转换，已保留纯文字；表格或格式需要核对。'],
    };
  }
}

export function richTextToMarkdown(html: string, plainText = ''): string {
  return convertRichText(html, plainText).markdown;
}

export function richTableGrid(html: string): HtmlTableGrid | null {
  if (!html) return null;
  const root = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['annotation'],
    ADD_ATTR: ['encoding'],
    RETURN_DOM: true,
  });
  if (!(root instanceof HTMLElement)) return null;
  const tables = [...root.querySelectorAll('table')].filter(
    (table) => !table.parentElement?.closest('table'),
  );
  if (tables.length !== 1) return null;
  const table = tables[0];
  const rest = root.cloneNode(true) as HTMLElement;
  rest.querySelector('table')?.remove();
  if (rest.textContent?.trim() || rest.querySelector('img')) return null;
  const notices = new Set<string>();
  const grid = readHtmlTable(table, (cell) => {
    const converted = convertRichText(cell, '', true);
    converted.notices.forEach((notice) => notices.add(notice));
    return converted.markdown;
  });
  if (!grid.rows.some((row) => row.length > 0)) return null;
  if (table.caption?.textContent?.trim()) {
    const caption = convertRichText(table.caption.innerHTML, '', true);
    grid.rows.unshift([caption.markdown, ...grid.alignments.slice(1).map(() => '')]);
    notices.add('表格说明已作为首行保留。');
  }
  grid.notices.push(...notices);
  return grid;
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
  const converted = convertRichText(body.innerHTML, plainText);
  converted.notices.forEach((notice) => notices.add(notice));
  return {
    markdown: [converted.markdown, ...appended].filter(Boolean).join('\n\n'),
    notices: [...notices],
  };
}
