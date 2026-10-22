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
