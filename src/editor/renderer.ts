import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js';
import type { RenderOptions } from './types';
import { headingId } from '../shared/markdown';
import { withoutFrontmatter } from './frontmatter';
import { iconMarkup } from '../ui/icon-markup';

export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

export function mathHtml(source: string, displayMode = false): string {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
    maxExpand: 1000,
  });
}

export function safeImageUrl(url: string): boolean {
  return /^(?:https?:|blob:|note-asset:|data:image\/(?:png|jpe?g|gif|webp|avif);)/i.test(url);
}

function numberedCode(highlighted: string, numbers: boolean): string {
  const open: string[] = [];
  const lines: string[] = [];
  let current = '';
  for (const part of highlighted.replace(/\n$/, '').split(/(<\/?span\b[^>]*>|\n)/g)) {
    if (part === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else {
      if (part.startsWith('<span')) open.push(part);
      else if (part === '</span>') open.pop();
      current += part;
    }
  }
  lines.push(current);
  return lines
    .map(
      (line, index) =>
        `<span class="code-line">${numbers ? `<span class="code-line-number" aria-hidden="true">${index + 1}</span>` : ''}<span class="code-line-content">${line || ' '}</span></span>`,
    )
    .join('');
}

export function createMarkdownParser(options: RenderOptions = {}): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });
  md.inline.ruler.before('escape', 'wiki_link', (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '[[') return false;
    const end = state.src.indexOf(']]', state.pos + 2);
    if (end < 0) return false;
    const [target, label] = state.src.slice(state.pos + 2, end).split('|');
    if (!target.trim()) return false;
    if (!silent) {
      const open = state.push('link_open', 'a', 1);
      open.attrSet('href', target.trim());
      const text = state.push('text', '', 0);
      text.content = label ?? target;
      state.push('link_close', 'a', -1);
    }
    state.pos = end + 2;
    return true;
  });
  md.inline.ruler.after('escape', 'inline_math', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    let end = state.pos + 1;
    while ((end = state.src.indexOf('$', end)) >= 0 && state.src[end - 1] === '\\') end++;
    if (end < 0 || end === state.pos + 1 || /\n/.test(state.src.slice(state.pos + 1, end)))
      return false;
    if (!silent) {
      const token = state.push('inline_math', 'span', 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.block.ruler.before(
    'fence',
    'block_math',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const first = state.src.slice(start, state.eMarks[startLine]);
      if (!first.startsWith('$$')) return false;
      let nextLine = startLine + 1;
      let content: string;
      if (first.length > 3 && first.endsWith('$$')) content = first.slice(2, -2);
      else {
        while (
          nextLine < endLine &&
          !/^\s*\$\$\s*$/.test(state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]))
        )
          nextLine++;
        if (nextLine === endLine) return false;
        content = [first.slice(2), state.getLines(startLine + 1, nextLine, state.blkIndent, false)]
          .filter(Boolean)
          .join('\n');
        nextLine++;
      }
      if (silent) return true;
      const token = state.push('block_math', 'div', 0);
      token.block = true;
      token.map = [startLine, nextLine];
      token.content = content;
      state.line = nextLine;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );
  md.renderer.rules.inline_math = (tokens, index) => mathHtml(tokens[index].content);
  md.renderer.rules.block_math = (tokens, index) =>
    `<div class="math-block">${mathHtml(tokens[index].content, true)}</div>\n`;
  md.renderer.rules.table_open = () => '<div class="markdown-table-scroll"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (language === 'mermaid')
      return `<div class="mermaid-diagram" data-mermaid="true"><pre>${escapeHtml(token.content)}</pre></div>\n`;
    let highlighted = escapeHtml(token.content);
    let detected = language;
    try {
      if (language && hljs.getLanguage(language))
        highlighted = hljs.highlight(token.content, { language, ignoreIllegals: true }).value;
      else if (!language && token.content.length < 50000) {
        const result = hljs.highlightAuto(token.content, [
          'javascript',
          'typescript',
          'java',
          'python',
          'sql',
          'xml',
          'css',
          'bash',
          'json',
          'cpp',
          'csharp',
          'rust',
          'go',
          'kotlin',
          'yaml',
        ]);
        highlighted = result.value;
        detected = result.language ?? 'text';
      }
    } catch {
      /* Unknown or incomplete code stays readable. */
    }
    const body = `<div class="code-body${options.codeWrap === false ? '' : ' code-wrap'}"><pre class="code-block"><code class="hljs language-${escapeHtml(detected || 'text')}">${numberedCode(highlighted, options.codeLineNumbers !== false)}</code></pre></div>`;
    const fold =
      options.codeFold === false
        ? ''
        : `<span class="code-fold-icon">${iconMarkup('ChevronDown', 14)}</span>`;
    const label = `${fold}<span class="code-language-label">${escapeHtml(language || `自动 · ${detected || 'text'}`)}</span><button type="button" class="code-copy" title="复制代码" data-code="${encodeURIComponent(token.content)}">${iconMarkup('Copy', 14)}<span class="code-copy-label">复制代码</span></button>`;
    const fontSize = Number.isFinite(options.codeFontSize)
      ? Math.min(72, Math.max(8, options.codeFontSize ?? 16))
      : 16;
    const lineHeight = Number.isFinite(options.codeLineHeight)
      ? Math.min(4, Math.max(1, options.codeLineHeight ?? 1.6))
      : 1.6;
    const style = `--code-font-size:${fontSize}px;--code-line-height:${lineHeight}`;
    return options.codeFold === false
      ? `<div class="code-container" style="${style}"><div class="code-caption">${label}</div>${body}</div>`
      : `<details class="code-container" style="${style}" open><summary class="code-caption">${label}</summary>${body}</details>`;
  };
  md.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    let reference = token.attrGet('src') ?? '';
    if (!/^[a-z][a-z\d+.-]*:/i.test(reference)) {
      try {
        reference = decodeURI(reference);
      } catch {
        /* Invalid percent escapes stay literal. */
      }
    }
    const resolved = options.resolveAsset?.(reference) ?? reference;
    const source = safeImageUrl(resolved) ? ` src="${escapeHtml(resolved)}"` : '';
    return `<img${source} data-asset-src="${escapeHtml(reference)}" alt="${escapeHtml(token.content)}" loading="lazy">`;
  };
  md.core.ruler.after('inline', 'task_lists', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue;
      const first = token.children[0];
      const match = first?.type === 'text' && first.content.match(/^\[([ xX])\]\s/);
      if (match) {
        first.content = first.content.slice(match[0].length);
        const checkbox = new state.Token('html_inline', '', 0);
        checkbox.content = `<input type="checkbox" disabled${match[1] !== ' ' ? ' checked' : ''} aria-label="任务状态"> `;
        token.children.unshift(checkbox);
      }
    }
  });
  md.core.ruler.after('inline', 'heading_ids', (state) => {
    const counts = new Map<string, number>();
    state.tokens.forEach((token, index) => {
      if (token.type !== 'heading_open') return;
      const title = (state.tokens[index + 1]?.children ?? [])
        .filter((child) => ['text', 'code_inline', 'image'].includes(child.type))
        .map((child) => child.content)
        .join('');
      const id = headingId(title);
      const count = counts.get(id) ?? 0;
      counts.set(id, count + 1);
      token.attrSet('id', count ? `${id}-${count}` : id);
    });
  });
  return md;
}

/** Raw HTML is disabled at parse time; generated HTML is sanitized at this boundary. */
export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  const html = createMarkdownParser(options).render(withoutFrontmatter(markdown));
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: ['data-code', 'data-mermaid', 'data-asset-src', 'loading'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel|blob|note-asset):|data:image\/(?:png|jpe?g|gif|webp|avif);|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}

let mermaidSerial = 0;
let mermaidReady: Promise<(typeof import('mermaid'))['default']> | undefined;

export async function hydrateMarkdown(
  root: HTMLElement,
  resolveAsset?: (path: string) => Promise<string>,
): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-asset-src]'));
  await Promise.all(
    images.map(async (image) => {
      const reference = image.dataset.assetSrc ?? '';
      if (safeImageUrl(reference) || !resolveAsset) return;
      try {
        const url = await resolveAsset(reference);
        if (safeImageUrl(url)) image.src = url;
        else image.title = '无法显示此图片地址';
      } catch {
        image.title = `图片无法读取：${reference}`;
      }
    }),
  );
  for (const diagram of root.querySelectorAll<HTMLElement>('[data-mermaid="true"]')) {
    if (diagram.dataset.rendered) continue;
    const source = diagram.textContent ?? '';
    diagram.dataset.rendered = 'pending';
    try {
      mermaidReady ??= import('mermaid').then((module) => {
        module.default.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: 'neutral',
          flowchart: { htmlLabels: false },
        });
        return module.default;
      });
      const mermaid = await mermaidReady;
      const result = await mermaid.render(`note-diagram-${++mermaidSerial}`, source);
      if (!diagram.isConnected) continue;
      diagram.innerHTML = DOMPurify.sanitize(result.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['foreignObject'],
        ADD_ATTR: ['dominant-baseline'],
      });
      diagram.dataset.rendered = 'true';
    } catch (error) {
      diagram.dataset.rendered = 'error';
      const message = document.createElement('small');
      message.className = 'diagram-error';
      message.textContent = `图表语法错误：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
      diagram.append(message);
    }
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('.code-copy')) {
    if (button.dataset.bound) continue;
    button.dataset.bound = 'true';
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(decodeURIComponent(button.dataset.code ?? ''));
        const label = button.querySelector('.code-copy-label') ?? button;
        label.textContent = '已复制';
        setTimeout(() => {
          label.textContent = '复制代码';
        }, 1200);
      } catch {
        (button.querySelector('.code-copy-label') ?? button).textContent = '复制失败';
      }
    });
  }
}
