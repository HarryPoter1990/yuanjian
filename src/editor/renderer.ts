import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js';
import type { RenderOptions } from './types';
import { installHeadingIds } from '../shared/heading-id';
import { withoutFrontmatter } from './frontmatter';
import { iconMarkup } from '../ui/icon-markup';
import { installMathSyntax } from '../shared/math-syntax';
import { wikiLinks } from '../shared/wiki';
import { installFootnotes } from '../shared/footnotes';
import { installNoteSyntax } from '../shared/note-syntax';

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
  options = { ...options, prototypeSyntax: options.prototypeSyntax ?? true };
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });
  wikiLinks(md);
  md.use(installFootnotes);
  installMathSyntax(md);
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
    const resolved = options.resolveAsset?.(reference, options.notePath) ?? reference;
    if (options.prototypeSyntax && options.resolveAsset && !safeImageUrl(resolved))
      return `<span class="note-reference-error" role="status">图片无法读取：${escapeHtml(reference)}</span>`;
    const source = safeImageUrl(resolved) ? ` src="${escapeHtml(resolved)}"` : '';
    const title = token.attrGet('title');
    const dimensions = ['width', 'height']
      .map((name) => (token.attrGet(name) ? ` ${name}="${escapeHtml(token.attrGet(name)!)}"` : ''))
      .join('');
    return `<img${source} data-asset-src="${escapeHtml(reference)}" alt="${escapeHtml(token.content)}"${title ? ` title="${escapeHtml(title)}"` : ''}${dimensions} loading="lazy">`;
  };
  md.core.ruler.after('inline', 'task_lists', (state) => {
    let listDepth = 0;
    const lines = state.src.split('\n');
    const starts = [0];
    for (const line of lines) starts.push(starts[starts.length - 1] + line.length + 1);
    for (const token of state.tokens) {
      if (token.type === 'list_item_open') listDepth++;
      if (token.type === 'list_item_close') listDepth--;
      if (!listDepth) continue;
      if (token.type !== 'inline' || !token.children) continue;
      const first = token.children[0];
      const match = first?.type === 'text' && token.content.match(/^\[([ xX])\]\s/);
      if (match) {
        const line = token.map?.[0];
        const within = line === undefined ? -1 : lines[line].indexOf(token.content.split('\n')[0]);
        if (line === undefined || within < 0) continue;
        const offset = starts[line] + within + 1;
        first.content = first.content.slice(match[0].length);
        const checkbox = new state.Token('html_inline', '', 0);
        checkbox.content = `<input type="checkbox" data-task-offset="${offset}" disabled${match[1] !== ' ' ? ' checked' : ''} aria-label="任务状态"> `;
        token.children.unshift(checkbox);
      }
    }
  });
  installHeadingIds(md);
  md.inline.ruler.before('html_inline', 'table_cell_break', (state, silent) => {
    if (!state.env.yuanjianTableCellBreaks || state.src[state.pos] !== '<') return false;
    const match = /^<br[ \t]*\/?>/i.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
      const token = state.push('hardbreak', 'br', 0);
      token.meta = { tableCellBreak: { from: state.pos, to: state.pos + match[0].length } };
    }
    state.pos += match[0].length;
    return true;
  });
  md.core.ruler.after('inline', 'table_cell_breaks', (state) => {
    let inCell = false;
    for (const token of state.tokens) {
      if (token.type === 'td_open' || token.type === 'th_open') inCell = true;
      else if (token.type === 'td_close' || token.type === 'th_close') inCell = false;
      else if (inCell && token.type === 'inline') {
        // Reparse the original cell source so escapes, entities and code remain distinct.
        token.children = [];
        md.inline.parse(
          token.content,
          md,
          { ...state.env, yuanjianTableCellBreaks: true },
          token.children,
        );
      }
    }
  });
  if (options.prototypeSyntax) installNoteSyntax(md, options, renderMarkdown);
  return md;
}

/** Raw HTML is disabled at parse time; generated HTML is sanitized at this boundary. */
export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  const html = createMarkdownParser(options).render(withoutFrontmatter(markdown));
  return sanitizeMarkdownHtml(html);
}

/** Reading navigation metadata is generated from parser maps, never from user HTML. */
export function renderReadingMarkdown(markdown: string, options: RenderOptions = {}): string {
  const body = withoutFrontmatter(markdown);
  const lineOffset = (markdown.slice(0, markdown.length - body.length).match(/\n/g) ?? []).length;
  const parser = createMarkdownParser(options);
  const environment = {};
  const tokens = parser.parse(body, environment);
  for (const type of new Set(
    tokens
      .filter((token) => token.block && token.map && !token.hidden && token.nesting !== -1)
      .map((token) => token.type),
  )) {
    const rule = parser.renderer.rules[type];
    parser.renderer.rules[type] = (items, index, opts, env, renderer) => {
      const html = rule
        ? rule(items, index, opts, env, renderer)
        : renderer.renderToken(items, index, opts);
      const map = items[index].map;
      return map
        ? html.replace(/^(\s*<[a-z][\w-]*)/i, `$1 data-source-line="${map[0] + lineOffset + 1}"`)
        : html;
    };
  }
  return sanitizeMarkdownHtml(parser.renderer.render(tokens, parser.options, environment));
}

export function renderParsedMarkdown(
  tokens: ReturnType<MarkdownIt['parse']>,
  options: RenderOptions = {},
  environment: object = {},
): string {
  const parser = createMarkdownParser(options);
  return sanitizeMarkdownHtml(parser.renderer.render(tokens, parser.options, environment));
}

function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: ['data-code', 'data-mermaid', 'data-asset-src', 'data-task-offset', 'loading'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel|blob|note-asset):|data:image\/(?:png|jpe?g|gif|webp|avif);|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}

let mermaidSerial = 0;
let mermaidReady: Promise<(typeof import('mermaid'))['default']> | undefined;

export async function hydrateMarkdown(
  root: HTMLElement,
  resolveAsset?: (path: string, from?: string) => Promise<string>,
): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-asset-src]'));
  await Promise.all(
    images.map(async (image) => {
      const reference = image.dataset.assetSrc ?? '';
      if (safeImageUrl(reference) || !resolveAsset) return;
      try {
        const url = image.dataset.assetFrom
          ? await resolveAsset(reference, image.dataset.assetFrom)
          : await resolveAsset(reference);
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
