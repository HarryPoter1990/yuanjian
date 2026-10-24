import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { extractLinks } from '../../src/shared/markdown';
import { inspectFrontmatter } from '../../src/shared/frontmatter';
import type {
  AttachmentCandidate,
  FileEntry,
  LocalizationResult,
  NoteLink,
} from '../../src/shared/types';
import { canonical, within } from './access';
import { imageExtensions, noteExtensions } from './adapters';
import { hash, isMissing, readOptional } from './io';
import type { NoteStore } from './store';
import { replaceImageTargets } from './markdown-ranges';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const referenceSyntax = new MarkdownIt({ html: true });
const contentExtensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
};

export class AttachmentStore {
  constructor(private readonly store: NoteStore) {}
  async put(
    notePath: string,
    name: string,
    bytes: number[],
  ): Promise<{ path: string; reference: string }> {
    notePath = await this.store.authorize(notePath);
    if (
      !bytes.length ||
      bytes.length > MAX_IMAGE_BYTES ||
      bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
    )
      throw new Error('图片为空、过大或字节数据无效');
    let safeName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
    if (!imageExtensions.has(path.extname(safeName).toLowerCase()))
      throw new Error('仅支持常见图片附件');
    if (safeName.length > 160) safeName = `${safeName.slice(0, 140)}${path.extname(safeName)}`;
    const parent = path.dirname(notePath);
    const rule = this.store
      .getSettings()
      .attachmentPattern.replace(
        /\{\{(?:note|name)\}\}/g,
        path.basename(notePath, path.extname(notePath)),
      );
    const directory = await canonical(path.resolve(parent, rule || 'assets'));
    if (!within(parent, directory)) throw new Error('附件目录越出笔记所在目录');
    const data = Buffer.from(bytes);
    return this.store.queue.run(async () => {
      await mkdir(directory, { recursive: true });
      let file = path.join(directory, safeName);
      const existing = await readOptional(file);
      if (existing && hash(existing) !== hash(data))
        file = path.join(
          directory,
          `${path.basename(safeName, path.extname(safeName))}-${hash(data).slice(0, 10)}${path.extname(safeName)}`,
        );
      const duplicate = await readOptional(file);
      if (duplicate && hash(duplicate) !== hash(data))
        throw new Error('附件目标存在不同内容，请重命名后重试');
      if (!duplicate) await writeFile(file, data, { flag: 'wx' });
      await this.store.approveFile(file);
      this.store.changed([file]);
      return {
        path: file,
        reference: path.relative(parent, file).split(path.sep).map(encodeURIComponent).join('/'),
      };
    });
  }

  private async download(url: string): Promise<{ bytes: Buffer; extension: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const fetchImage = this.store.adapters.fetch ?? fetch;
    let current = new URL(url);
    try {
      for (let redirects = 0; redirects <= 4; redirects++) {
        if (!['http:', 'https:'].includes(current.protocol) || current.username || current.password)
          throw new Error('仅支持无账号信息的 HTTP(S) 图片地址');
        const response = await fetchImage(current, {
          signal: controller.signal,
          redirect: 'manual',
          credentials: 'omit',
          headers: { Accept: 'image/*' },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === 4) throw new Error('图片重定向次数过多或地址无效');
          current = new URL(location, current);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`图片下载失败（HTTP ${response.status}）`);
        }
        const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
        const extension = contentExtensions[type];
        if (!extension) {
          await response.body?.cancel();
          throw new Error('服务器未返回支持的图片类型');
        }
        if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
          await response.body?.cancel();
          throw new Error('图片超过 25 MiB 限制');
        }
        if (!response.body) throw new Error('图片响应为空');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new Error('图片超过 25 MiB 限制');
          }
          chunks.push(value);
        }
        if (!total) throw new Error('图片响应为空');
        return { bytes: Buffer.concat(chunks), extension };
      }
      throw new Error('图片下载失败');
    } finally {
      clearTimeout(timer);
    }
  }
  async localize(
    notePath: string,
    content: string,
    selectedUrls?: string[],
  ): Promise<{ content: string; results: LocalizationResult[] }> {
    notePath = await this.store.authorize(notePath);
    const urls = [
      ...new Set(
        extractLinks(content)
          .filter((link) => link.image && /^https?:\/\//i.test(link.target))
          .map((link) => link.target),
      ),
    ].filter((url) => selectedUrls === undefined || selectedUrls.includes(url));
    const results: LocalizationResult[] = [];
    const references = new Map<string, string>();
    const id = randomUUID();
    this.store.adapters.progress?.({
      id,
      kind: 'localize-images',
      completed: 0,
      total: urls.length,
      message: '准备下载图片',
    });
    for (const url of urls) {
      try {
        const { bytes, extension } = await this.download(url);
        const attachment = await this.put(
          notePath,
          `image-${hash(bytes).slice(0, 12)}${extension}`,
          [...bytes],
        );
        results.push({ url, path: attachment.path });
        references.set(url, attachment.reference);
      } catch (error) {
        results.push({ url, error: error instanceof Error ? error.message : '下载失败' });
      }
      this.store.adapters.progress?.({
        id,
        kind: 'localize-images',
        completed: results.length,
        total: urls.length,
        message: results.at(-1)?.error ? '图片失败，已保留原始网址' : '图片已本地化',
      });
    }
    return { content: replaceImageTargets(content, references), results };
  }
  async scan(): Promise<AttachmentCandidate[]> {
    const candidates = new Map<string, AttachmentCandidate>();
    const notes = new Set<string>();
    const uncertainty = new Set<string>();
    const collect = async (entries: FileEntry[]): Promise<void> => {
      for (const entry of entries) {
        if (entry.children) await collect(entry.children);
        else if (entry.kind === 'note') notes.add(entry.path);
        else if (entry.kind === 'attachment') {
          let bytes = 0;
          const uncertainReasons: string[] = [];
          try {
            bytes = (await stat(entry.path)).size;
          } catch {
            uncertainReasons.push('无法确认附件文件状态，请重新扫描');
          }
          candidates.set(entry.path, {
            path: entry.path,
            bytes,
            references: [],
            ...(uncertainReasons.length ? { uncertainReasons } : {}),
          });
        }
      }
    };
    for (const root of this.store.getRoots()) {
      try {
        await collect(await this.store.getTree(root));
      } catch {
        uncertainty.add(`无法完整读取目录「${path.basename(root)}」，引用状态不确定`);
      }
    }
    const references = new Map<string, NoteLink[]>();
    const addReferences = (file: string, content: string): void => {
      if (inspectFrontmatter(content)?.error)
        uncertainty.add(`「${path.basename(file)}」的属性存在错误，无法确认全部引用`);
      const tokens = referenceSyntax.parse(content, {});
      const hasResourceHtml = tokens.some((token) =>
        [token, ...(token.children ?? [])].some(
          (part) =>
            ['html_block', 'html_inline'].includes(part.type) &&
            /<(?:img|video|audio|source|picture|object|embed|iframe|image|use)\b|\b(?:src|srcset|href|poster|data)\s*=|url\s*\(/i.test(
              part.content.replace(/<!--[\s\S]*?-->/g, ''),
            ),
        ),
      );
      if (hasResourceHtml)
        uncertainty.add(`「${path.basename(file)}」含有尚未完整解析的 HTML 资源引用`);
      const links = extractLinks(content);
      if (
        links.some(
          (link) =>
            link.image &&
            !/^[a-z][a-z\d+.-]*:/i.test(link.target) &&
            !imageExtensions.has(path.extname(link.target.split('#')[0]).toLowerCase()),
        )
      )
        uncertainty.add(`「${path.basename(file)}」含有无法确认内容的嵌入引用`);
      references.set(file, [...(references.get(file) ?? []), ...links]);
    };
    // Candidate files remain restricted to indexed roots. Already approved standalone notes and
    // unsaved session content can only add protections; they never widen the deletion scope.
    for (const file of this.store.getApprovedPaths().files) {
      if (notes.has(file) || !noteExtensions.has(path.extname(file).toLowerCase())) continue;
      try {
        if ((await stat(file)).isFile()) notes.add(file);
        else uncertainty.add(`无法确认「${path.basename(file)}」是否仍为笔记文件`);
      } catch (error) {
        // Authorization outlives a deleted file; a confirmed old absence is not an unreadable source.
        if (!isMissing(error))
          uncertainty.add(`无法读取「${path.basename(file)}」，引用状态不确定`);
      }
    }
    for (const file of notes) {
      try {
        addReferences(file, (await this.store.readNote(file)).content);
      } catch {
        uncertainty.add(`无法读取「${path.basename(file)}」，引用状态不确定`);
      }
    }
    for (const tab of this.store.getSession().tabs)
      if (tab.dirty) {
        if (tab.path) {
          try {
            addReferences(await this.store.authorize(tab.path), tab.content);
          } catch {
            uncertainty.add(`无法确认草稿「${tab.title}」的引用位置`);
          }
        } else if (extractLinks(tab.content).some((link) => link.image))
          uncertainty.add(`未命名草稿「${tab.title}」含有无法定位的图片引用`);
      }
    for (const [source, links] of references) {
      for (const link of links) {
        if (
          /^[a-z][a-z\d+.-]*:/i.test(link.target) &&
          !path.isAbsolute(link.target) &&
          !link.target.startsWith('file:')
        )
          continue;
        let target = link.target.split('#')[0].split('|')[0];
        try {
          target = target.startsWith('file:') ? fileURLToPath(target) : decodeURIComponent(target);
        } catch {
          /* keep literal */
        }
        let resolved: string;
        try {
          resolved = await canonical(path.resolve(path.dirname(source), target));
        } catch {
          uncertainty.add(`无法确认「${path.basename(source)}」中的资源位置`);
          continue;
        }
        const direct = candidates.get(resolved);
        const matches = direct
          ? [direct]
          : [...candidates.values()].filter(
              (candidate) => path.basename(candidate.path) === path.basename(target),
            );
        // Ambiguous short-name references are all kept; a cleanup candidate must be conservative.
        for (const candidate of matches)
          if (!candidate.references.includes(source)) candidate.references.push(source);
      }
    }
    return [...candidates.values()]
      .filter((candidate) => candidate.references.length === 0)
      .map((candidate) => {
        const reasons = [...new Set([...(candidate.uncertainReasons ?? []), ...uncertainty])];
        return reasons.length ? { ...candidate, uncertainReasons: reasons } : candidate;
      })
      .sort((a, b) => b.bytes - a.bytes);
  }
  async trash(files: string[]): Promise<void> {
    const verify = async (file: string, scanned?: AttachmentCandidate[]): Promise<void> => {
      const candidate = (scanned ?? (await this.scan())).find((item) => item.path === file);
      if (!candidate || candidate.uncertainReasons?.length)
        throw new Error('附件仍被引用或引用状态不确定，无法确认可以清理，请重新扫描');
    };
    const scanned = await this.scan();
    for (const candidate of files) {
      const file = await this.store.authorize(candidate);
      await verify(file, scanned);
    }
    for (const file of files) await this.store.trashFile(file, () => verify(file));
  }
}
