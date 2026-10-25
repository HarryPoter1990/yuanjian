import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import type {
  ImportEncoding,
  ImportSource,
  SaveRequest,
  TransferItem,
} from '../../src/shared/types';
import { extractLinks } from '../../src/shared/markdown';
import { canonical, within } from '../storage/access';
import { imageExtensions, noteExtensions } from '../storage/adapters';
import { hash, OperationQueue, readJson, readOptional, writeJson } from '../storage/io';
import { linkTargetRanges, replaceImageTargets } from '../storage/markdown-ranges';
import type { NoteStore } from '../storage/store';
import { htmlSourceReferences } from './html-source-references';

const MAX_SOURCE = 64 * 1024 * 1024;
const MAX_IMAGE = 25 * 1024 * 1024;
const syntax = new MarkdownIt();
const mime: Record<string, string> = {
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
interface SourceRecord {
  id: string;
  path: string;
  digest: string;
  format: ImportSource['format'];
  encoding: ImportEncoding;
  images: string[];
  links: string[];
}
const normalized = (value: string) => syntax.normalizeLink(syntax.utils.unescapeAll(value));
function decode(bytes: Buffer, encoding: ImportEncoding): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`文件无法按 ${encoding} 解码，请在导入预览中选择其他编码。`);
  }
}
function defaultEncoding(bytes: Buffer): ImportEncoding {
  if (bytes[0] === 255 && bytes[1] === 254) return 'utf-16le';
  if (bytes[0] === 254 && bytes[1] === 255) return 'utf-16be';
  try {
    decode(bytes, 'utf-8');
    return 'utf-8';
  } catch {
    return 'gb18030';
  }
}

/** The registry is populated only from main-process native selections or real dropped Files. */
export class TransferService {
  private readonly queue = new OperationQueue();
  private readonly registry: string;
  constructor(
    private readonly store: NoteStore,
    private readonly adapters: { chooseFiles(): Promise<string[]> },
  ) {
    this.registry = path.join(store.dataDirectory, 'imports', 'sources.json');
  }
  private async records(): Promise<SourceRecord[]> {
    const records = await readJson<SourceRecord[]>(this.registry, []);
    if (
      !Array.isArray(records) ||
      records.some(
        (record) =>
          !record ||
          !/^[\da-f-]{36}$/.test(record.id) ||
          !path.isAbsolute(record.path) ||
          !/^[\da-f]{64}$/.test(record.digest) ||
          !['html', 'csv', 'tsv'].includes(record.format) ||
          !['utf-8', 'gb18030', 'utf-16le', 'utf-16be'].includes(record.encoding) ||
          !Array.isArray(record.images) ||
          !Array.isArray(record.links) ||
          [...record.images, ...record.links].some((value) => typeof value !== 'string'),
      )
    )
      throw new Error('导入来源记录损坏，原数据已保留。');
    return records;
  }
  private async source(id: string): Promise<{ record: SourceRecord; bytes: Buffer }> {
    const record = (await this.records()).find((value) => value.id === id);
    if (!record) throw new Error('无法确认这份导入草稿的来源，请重新选择原文件。');
    const file = await canonical(record.path);
    if (file !== record.path) throw new Error('导入源位置已改变，请重新选择原文件。');
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_SOURCE)
      throw new Error('导入来源不是普通文件或超过 64 MiB。');
    const bytes = await readFile(file);
    if (hash(bytes) !== record.digest)
      throw new Error('导入来源已在外部改变，请重新导入；当前草稿仍保留。');
    return {
      record: {
        ...record,
        ...(record.format === 'html' ? htmlSourceReferences(decode(bytes, record.encoding)) : {}),
      },
      bytes,
    };
  }
  async chooseImports(): Promise<TransferItem[]> {
    return this.preparePaths(await this.adapters.chooseFiles());
  }
  async preparePaths(paths: string[]): Promise<TransferItem[]> {
    if (paths.length > 100) throw new Error('每次最多处理 100 个文件或目录。');
    const results: TransferItem[] = [];
    for (const candidate of paths) {
      const name = path.basename(candidate) || '未知文件';
      try {
        const file = await canonical(candidate),
          info = await stat(file);
        if (info.isDirectory()) {
          results.push({ kind: 'directory', name, path: await this.store.approveDirectory(file) });
          continue;
        }
        if (!info.isFile() || info.size > MAX_SOURCE)
          throw new Error('不是普通文件或超过 64 MiB 限制。');
        const extension = path.extname(file).toLowerCase();
        if (noteExtensions.has(extension)) {
          await this.store.approveFile(file);
          const note = await this.store.openFile(file);
          if (!note) throw new Error('文件未打开。');
          results.push({ kind: 'note', name, note });
          continue;
        }
        if (imageExtensions.has(extension)) {
          if (info.size > MAX_IMAGE) throw new Error('图片超过 25 MiB 限制。');
          results.push({
            kind: 'image',
            name,
            bytes: [...(await readFile(file))],
            mime: mime[extension],
          });
          continue;
        }
        const format =
          extension === '.html' || extension === '.htm'
            ? 'html'
            : extension === '.csv'
              ? 'csv'
              : extension === '.tsv'
                ? 'tsv'
                : null;
        if (!format) throw new Error('不支持此文件；可导入 Markdown、TXT、HTML、CSV/TSV 或图片。');
        const bytes = await readFile(file),
          encoding = defaultEncoding(bytes),
          text = decode(bytes, encoding);
        const record: SourceRecord = {
          id: randomUUID(),
          path: file,
          digest: hash(bytes),
          format,
          encoding,
          ...(format === 'html' ? htmlSourceReferences(text) : { images: [], links: [] }),
        };
        await this.queue.run(async () => {
          const records = await this.records();
          await writeJson(this.registry, [...records, record]);
        });
        results.push({
          kind: 'source',
          name,
          source: { id: record.id, path: file, name, format, text, encoding },
        });
      } catch (error) {
        results.push({
          kind: 'error',
          name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }
  async readImport(id: string, encoding: ImportEncoding): Promise<ImportSource> {
    return this.queue.run(async () => {
      const { record, bytes } = await this.source(id),
        text = decode(bytes, encoding);
      const updated = {
        ...record,
        encoding,
        ...(record.format === 'html' ? htmlSourceReferences(text) : { images: [], links: [] }),
      };
      await writeJson(
        this.registry,
        (await this.records()).map((value) => (value.id === id ? updated : value)),
      );
      return {
        id,
        path: record.path,
        name: path.basename(record.path),
        format: record.format,
        text,
        encoding,
      };
    });
  }
  private async referenced(record: SourceRecord, target: string, image: boolean): Promise<string> {
    const listed = image ? record.images : record.links;
    const declared = listed.find((value) => normalized(value) === normalized(target));
    if (!declared) throw new Error('此资源不在原始 HTML 的已确认引用中。');
    let reference: string;
    try {
      reference = decodeURIComponent(declared.split('#')[0].split('?')[0]);
    } catch {
      reference = declared.split('#')[0].split('?')[0];
    }
    const root = await canonical(path.dirname(record.path));
    const file = await canonical(path.resolve(root, reference));
    if (!within(root, file) || (image && !imageExtensions.has(path.extname(file).toLowerCase())))
      throw new Error('资源越出来源目录或不是支持的本地图片。');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('来源附件不是普通文件。');
    if (image && info.size > MAX_IMAGE) throw new Error('图片超过 25 MiB 限制。');
    return file;
  }
  async resolveAsset(id: string, target: string): Promise<string> {
    const { record } = await this.source(id);
    return this.referenced(record, target, true);
  }
  private async copyImage(source: string, notePath: string): Promise<string> {
    const info = await stat(source);
    if (info.size > MAX_IMAGE) throw new Error('图片超过 25 MiB 限制。');
    const bytes = await readFile(source),
      parent = path.dirname(notePath),
      stem = path.basename(notePath, path.extname(notePath));
    if (bytes.byteLength > MAX_IMAGE) throw new Error('图片超过 25 MiB 限制。');
    const rule = this.store.getSettings().attachmentPattern.replace(/\{\{(?:note|name)\}\}/g, stem);
    const directory = await canonical(path.resolve(parent, rule || 'assets'));
    if (!within(parent, directory)) throw new Error('附件目录越出保存位置。');
    await mkdir(directory, { recursive: true });
    const candidate = async (name: string): Promise<string> => {
      const resolved = await canonical(path.join(directory, name));
      if (!within(directory, resolved)) throw new Error('附件目标越出附件目录。');
      return resolved;
    };
    let target = await candidate(path.basename(source)),
      existing = await readOptional(target);
    if (existing && hash(existing) !== hash(bytes))
      target = await candidate(
        `${path.basename(source, path.extname(source))}-${hash(bytes).slice(0, 10)}${path.extname(source)}`,
      );
    existing = await readOptional(target);
    if (existing && hash(existing) !== hash(bytes))
      throw new Error('附件目标已有其他内容，未覆盖。');
    if (!existing) await writeFile(target, bytes, { flag: 'wx' });
    await this.store.approveFile(target);
    return path.relative(parent, target).split(path.sep).map(encodeURIComponent).join('/');
  }
  async prepareSave(
    request: SaveRequest,
    targetPath: string,
  ): Promise<{ content: string; notices?: string[] }> {
    if (!request.importSourceId) return { content: request.content };
    const registered = (await this.records()).find((value) => value.id === request.importSourceId);
    if (!registered) throw new Error('无法确认导入来源，当前草稿已保留。');
    if (registered.format !== 'html') return { content: request.content };
    const { record } = await this.source(request.importSourceId);
    const images = new Map<string, string>(),
      links = new Map<string, string>(),
      notices: string[] = [];
    const visible = extractLinks(request.content);
    for (const reference of record.images) {
      if (!visible.some((link) => link.image && normalized(link.target) === normalized(reference)))
        continue;
      try {
        const file = await this.referenced(record, reference, true);
        images.set(reference, await this.copyImage(file, targetPath));
      } catch (error) {
        notices.push(
          `图片“${reference}”未整理：${error instanceof Error ? error.message : String(error)}；已保留原引用。`,
        );
      }
    }
    for (const reference of record.links) {
      if (!visible.some((link) => !link.image && normalized(link.target) === normalized(reference)))
        continue;
      try {
        const file = await this.referenced(record, reference, false);
        const relative = path
          .relative(path.dirname(targetPath), file)
          .split(path.sep)
          .map(encodeURIComponent)
          .join('/');
        links.set(
          reference,
          relative + (reference.includes('#') ? '#' + reference.split('#').slice(1).join('#') : ''),
        );
      } catch (error) {
        notices.push(
          `链接“${reference}”未整理：${error instanceof Error ? error.message : String(error)}；已保留原引用。`,
        );
      }
    }
    let content = replaceImageTargets(request.content, images);
    for (const range of linkTargetRanges(content)
      .filter((value) => !value.image)
      .sort((a, b) => b.from - a.from)) {
      const replacement = links.get(range.target);
      if (replacement)
        content = content.slice(0, range.from) + replacement + content.slice(range.to);
    }
    return { content, notices };
  }
}
