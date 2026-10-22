import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import type { FontEntry } from '../../src/shared/types';
import { extractLinks } from '../../src/shared/markdown';
import type { NoteStore } from '../storage/store';
import { atomicWrite, hash } from '../storage/io';
import { canonical, within } from '../storage/access';
import { linkTargetRanges } from '../storage/markdown-ranges';

interface ExportAdapters {
  chooseSave: (suggested: string, format: 'html' | 'pdf' | 'zip') => Promise<string | null>;
  renderPdf: (htmlFile: string, target: string) => Promise<void>;
  assetData: (url: string) => Promise<{ bytes: Uint8Array; mime: string }>;
  buildDirectory: string;
  managedFonts?: () => Promise<FontEntry[]>;
}
interface ExportRequest {
  format: 'html' | 'pdf';
  html: string;
  notePath: string | null;
  title: string;
}
const fontMime: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ttc': 'font/collection',
  '.otc': 'font/collection',
};
const imageMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};
const dataUri = (bytes: Uint8Array, mime: string): string =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const unquote = (value: string): string => value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
const cssString = (value: string): string => value.replace(/["\\<>\r\n]/g, '');
const safeFilename = (value: string): string =>
  value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/, '')
    .slice(0, 150) || '笔记';
const decodeAttribute = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)));

function visibleCodepoints(html: string): Set<number> {
  const text = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '');
  const decoded = decodeAttribute(text).replace(/&#x([\da-f]+);/gi, (_whole, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  );
  return new Set([...decoded].map((character) => character.codePointAt(0)!));
}
function neededRange(rule: string, codepoints: Set<number>): boolean {
  const declaration = /unicode-range\s*:\s*([^;}]+)/i.exec(rule)?.[1];
  if (!declaration) return true;
  for (const range of declaration.split(',')) {
    const match = /^\s*U\+([\da-f?]+)(?:-([\da-f]+))?\s*$/i.exec(range);
    if (!match) throw new Error('导出字体的 unicode-range 格式无法识别');
    const start = Number.parseInt(match[1].replace(/\?/g, '0'), 16);
    const end = match[2]
      ? Number.parseInt(match[2], 16)
      : Number.parseInt(match[1].replace(/\?/g, 'f'), 16);
    for (const codepoint of codepoints) if (codepoint >= start && codepoint <= end) return true;
  }
  return false;
}
async function asyncReplace(
  source: string,
  pattern: RegExp,
  replacement: (match: RegExpMatchArray) => Promise<string>,
): Promise<string> {
  let output = source;
  const matches = [...source.matchAll(pattern)];
  for (const match of matches.reverse())
    output =
      output.slice(0, match.index) +
      (await replacement(match)) +
      output.slice(match.index + match[0].length);
  return output;
}

export class ExportManager {
  constructor(
    private readonly store: NoteStore,
    private readonly adapters: ExportAdapters,
  ) {}

  private async outputPath(
    suggested: string,
    format: 'html' | 'pdf' | 'zip',
    notePath?: string | null,
  ): Promise<string | null> {
    const selected = await this.adapters.chooseSave(suggested, format);
    if (!selected) return null;
    const target = await canonical(selected);
    if (path.extname(target).toLowerCase() !== `.${format}`)
      throw new Error(`导出文件必须使用 .${format} 扩展名`);
    if (notePath && target === (await canonical(notePath)))
      throw new Error('导出位置不能覆盖源笔记');
    return target;
  }
  private async temporary<T>(operation: (directory: string) => Promise<T>): Promise<T> {
    const directory = path.join(this.store.dataDirectory, 'exports');
    await mkdir(directory, { recursive: true });
    const temporary = await mkdtemp(path.join(directory, 'export-'));
    try {
      return await operation(temporary);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  private async cssUrl(url: string, cssFile: string): Promise<string> {
    if (url.startsWith('data:')) return url;
    if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//'))
      throw new Error('导出样式包含无法离线打包的外部资源');
    const build = await canonical(this.adapters.buildDirectory);
    const relative = url.split(/[?#]/)[0];
    let decoded: string;
    try {
      decoded = decodeURIComponent(relative);
    } catch {
      throw new Error('导出样式资源路径编码无效');
    }
    const file = await canonical(
      decoded.startsWith('/')
        ? path.join(build, decoded.replace(/^\/+/, ''))
        : path.resolve(path.dirname(cssFile), decoded),
    );
    if (!within(build, file)) throw new Error('导出样式资源越出程序构建目录');
    const mime =
      fontMime[path.extname(file).toLowerCase()] ?? imageMime[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`不支持的导出样式资源：${path.basename(file)}`);
    try {
      return dataUri(await readFile(file), mime);
    } catch {
      throw new Error(`导出字体或样式资源缺失：${path.basename(file)}`);
    }
  }
  private inlineCss(css: string, cssFile: string): Promise<string> {
    return asyncReplace(
      css,
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
      async (match) => `url("${await this.cssUrl(match[1] ?? match[2] ?? match[3], cssFile)}")`,
    );
  }
  private async styles(html: string): Promise<string> {
    const assets = path.join(this.adapters.buildDirectory, 'assets');
    let names: string[];
    try {
      names = (await readdir(assets)).filter((name) => name.endsWith('.css')).sort();
    } catch {
      throw new Error('导出所需的程序样式不存在，请先完成程序构建');
    }
    if (!names.length) throw new Error('导出所需的程序样式不存在，请先完成程序构建');
    const settings = this.store.getSettings();
    const selected = new Set(
      [
        settings.appearance.bodyFont,
        settings.appearance.headingFont,
        settings.appearance.codeFont,
      ].map((name) => name.toLocaleLowerCase()),
    );
    const codepoints = visibleCodepoints(html);
    const chunks: string[] = [];
    let mathStyles = false;
    const includedFamilies = new Set<string>();
    for (const name of names) {
      const file = await canonical(path.join(assets, name));
      if (!within(await canonical(this.adapters.buildDirectory), file))
        throw new Error('导出样式文件越出程序目录');
      const css = await readFile(file, 'utf8');
      if (/\.katex[\s{.:>,]/.test(css)) mathStyles = true;
      const fonts: string[] = [];
      for (const match of css.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
        const family = unquote(/font-family\s*:\s*([^;}]*)/i.exec(match[0])?.[1] ?? '');
        if (
          !family ||
          (!/^KaTeX_/i.test(family) &&
            (!selected.has(family.toLocaleLowerCase()) || !neededRange(match[0], codepoints)))
        )
          continue;
        let rule = match[0];
        const source = /src\s*:\s*([^;}]*)/i.exec(rule);
        if (source) {
          const woff2 = /url\([^)]*\)\s*format\(\s*['"]?woff2(?:-variations)?['"]?\s*\)/i.exec(
            source[1],
          );
          if (woff2) rule = rule.replace(source[0], `src:${woff2[0]}`);
        }
        fonts.push(await this.inlineCss(rule, file));
        includedFamilies.add(family.toLocaleLowerCase());
      }
      chunks.push(
        ...fonts,
        await this.inlineCss(css.replace(/@font-face\s*\{[^}]*\}/gi, ''), file),
      );
    }
    if (
      /class\s*=\s*['"][^'"]*\bkatex\b/i.test(html) &&
      (!mathStyles || ![...includedFamilies].some((family) => family.startsWith('katex_')))
    )
      throw new Error('导出数学公式所需的 KaTeX 样式或字体缺失');
    const managed = (await this.adapters.managedFonts?.()) ?? [];
    for (const font of managed) {
      if (!selected.has(font.name.toLocaleLowerCase())) continue;
      let bytes: Uint8Array;
      let mime: string;
      if (font.url) ({ bytes, mime } = await this.adapters.assetData(font.url));
      else if (font.path) {
        const file = await canonical(font.path);
        if (!within(await canonical(path.join(this.store.dataDirectory, 'fonts')), file))
          throw new Error('管理字体越出软件字体目录');
        bytes = await readFile(file);
        mime = fontMime[path.extname(file).toLowerCase()] ?? '';
      } else throw new Error(`所选字体资源缺失：${font.name}`);
      if (!mime.startsWith('font/') && !mime.includes('font'))
        throw new Error(`所选字体格式无法识别：${font.name}`);
      chunks.push(
        `@font-face{font-family:"${cssString(font.name)}";src:url("${dataUri(bytes, mime)}");font-display:swap}`,
      );
      includedFamilies.add(font.name.toLocaleLowerCase());
    }
    const bundled = new Set(
      ['Noto Sans SC Variable', 'Noto Serif SC Variable', 'Inter Variable', 'JetBrains Mono'].map(
        (name) => name.toLocaleLowerCase(),
      ),
    );
    for (const family of selected)
      if (bundled.has(family) && !includedFamilies.has(family) && codepoints.size) {
        // A family with only nonmatching Unicode subsets can legitimately have no glyphs in this text.
        const allCss = (
          await Promise.all(names.map((name) => readFile(path.join(assets, name), 'utf8')))
        ).join('\n');
        if (!allCss.toLocaleLowerCase().includes(family))
          throw new Error(`导出所选内置字体资源缺失：${family}`);
      }
    return chunks.join('\n');
  }
  private async standaloneHtml(request: ExportRequest): Promise<string> {
    if (
      !/<html\b/i.test(request.html) ||
      !/<head\b/i.test(request.html) ||
      !/<body\b/i.test(request.html)
    )
      throw new Error('导出需要完整的 HTML 文档');
    let originalStyles = [...request.html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)]
      .map((match) => match[0])
      .join('\n');
    originalStyles = await asyncReplace(
      originalStyles,
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
      async (match) => {
        const url = decodeAttribute(match[1] ?? match[2] ?? match[3]);
        if (!url.startsWith('note-asset:')) return match[0];
        const resource = await this.adapters.assetData(url);
        if (!resource.mime.startsWith('image/')) throw new Error('壁纸资源不是支持的图片');
        return `url("${dataUri(resource.bytes, resource.mime)}")`;
      },
    );
    let html = request.html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
    html = await asyncReplace(
      html,
      /\b(src|poster)\s*=\s*("([^"]*)"|'([^']*)')/gi,
      async (match) => {
        const url = decodeAttribute(match[3] ?? match[4]);
        if (/^(?:data:|https?:\/\/|#)/i.test(url)) return match[0];
        let resource: { bytes: Uint8Array; mime: string };
        if (url.startsWith('note-asset:')) resource = await this.adapters.assetData(url);
        else {
          if (!request.notePath) throw new Error('本地图片缺少源笔记位置，无法打包');
          const file = await this.store.resolveAssetPath(url, request.notePath);
          resource = {
            bytes: await this.store.readAuthorizedFile(file),
            mime: imageMime[path.extname(file).toLowerCase()] ?? '',
          };
        }
        if (!resource.mime.startsWith('image/'))
          throw new Error('导出正文引用了不支持的本地图片资源');
        return `${match[1]}="${dataUri(resource.bytes, resource.mime)}"`;
      },
    );
    const styles = await this.styles(html);
    const appearance = this.store.getSettings().appearance;
    const variables = `:root{--body-font:"${cssString(appearance.bodyFont)}";--heading-font:"${cssString(appearance.headingFont)}";--code-font:"${cssString(appearance.codeFont)}"}`;
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src data:; base-uri 'none'; form-action 'none'">`;
    html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*['"]Content-Security-Policy['"][^>]*>/gi, '');
    return html.replace(
      /<\/head\s*>/i,
      `${csp}<style>${styles.replace(/<\/style/gi, '<\\/style')}\n${variables}</style>${originalStyles}</head>`,
    );
  }
  async exportDocument(request: ExportRequest): Promise<string | null> {
    if (request.notePath) await this.store.authorize(request.notePath);
    const target = await this.outputPath(
      `${safeFilename(request.title)}.${request.format}`,
      request.format,
      request.notePath,
    );
    if (!target) return null;
    return this.temporary(async (directory) => {
      const html = await this.standaloneHtml(request);
      const input = path.join(directory, 'document.html');
      await atomicWrite(input, html);
      if (request.format === 'html') await atomicWrite(target, html);
      else {
        const output = path.join(directory, 'document.pdf');
        await this.adapters.renderPdf(input, output);
        const bytes = await readFile(output);
        if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
          throw new Error('PDF 渲染器没有生成有效的 PDF 文件');
        await atomicWrite(target, bytes);
      }
      return target;
    });
  }
  async exportBundle(notePath: string, content: string): Promise<string | null> {
    notePath = await this.store.authorize(notePath);
    const target = await this.outputPath(
      `${safeFilename(path.basename(notePath, path.extname(notePath)))}.zip`,
      'zip',
      notePath,
    );
    if (!target) return null;
    const archive: Record<string, Uint8Array> = {};
    const references = new Map<string, string>();
    const usedNames = new Set<string>();
    const contentNames = new Map<string, string>();
    for (const link of extractLinks(content).filter((link) => link.image)) {
      if (/^https?:\/\/|^data:/i.test(link.target)) continue;
      if (
        /^[a-z][a-z\d+.-]*:/i.test(link.target) &&
        !path.isAbsolute(link.target) &&
        !link.target.startsWith('file:')
      )
        throw new Error('ZIP 含有无法打包的图片地址，请先将图片本地化');
      let file: string;
      let bytes: Buffer;
      try {
        file = await this.store.resolveAssetPath(link.target, notePath);
        bytes = await this.store.readAuthorizedFile(file);
      } catch {
        throw new Error(`无法读取笔记引用的本地图片：${link.target}`);
      }
      if (!imageMime[path.extname(file).toLowerCase()])
        throw new Error(`不支持的本地图片附件：${link.target}`);
      const fingerprint = hash(bytes);
      let name = contentNames.get(fingerprint);
      if (!name) {
        const basename = safeFilename(path.basename(file));
        name = `assets/${basename}`;
        if (usedNames.has(name.toLocaleLowerCase()))
          name = `assets/${path.basename(basename, path.extname(basename))}-${fingerprint.slice(0, 10)}${path.extname(basename)}`;
        usedNames.add(name.toLocaleLowerCase());
        contentNames.set(fingerprint, name);
        archive[name] = bytes;
      }
      references.set(link.target, name.split('/').map(encodeURIComponent).join('/'));
    }
    let exported = content;
    for (const range of linkTargetRanges(content).reverse()) {
      const reference = references.get(range.target);
      if (reference)
        exported = exported.slice(0, range.from) + reference + exported.slice(range.to);
    }
    archive[path.basename(notePath)] = strToU8(exported);
    await atomicWrite(target, zipSync(archive, { level: 6 }));
    return target;
  }
}
