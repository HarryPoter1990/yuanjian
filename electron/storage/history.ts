import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { extractLinks } from '../../src/shared/markdown';
import type { HistoryEntry, HistoryStats, Settings } from '../../src/shared/types';
import { atomicWrite, hash, isMissing, readJson, readOptional, writeJson } from './io';
import { imageExtensions } from './adapters';

interface ImageCopy {
  original: string;
  blob: string;
  bytes: number;
}
interface StoredEntry extends HistoryEntry {
  images: ImageCopy[];
  contentHash: string;
}
interface HistoryOptions {
  directory: string;
  settings: () => Settings;
  resolveAsset: (target: string, from: string) => Promise<string>;
  now: () => number;
}

export class HistoryStore {
  private entries: StoredEntry[] = [];
  private readonly directory: string;
  constructor(private readonly options: HistoryOptions) {
    this.directory = path.join(options.directory, 'history');
  }
  private textPath(id: string): string {
    return path.join(this.directory, 'text', `${id}.md`);
  }
  private blobPath(blob: string): string {
    return path.join(this.directory, 'images', blob);
  }
  private persist(): Promise<void> {
    return writeJson(path.join(this.directory, 'index.json'), this.entries);
  }
  async initialize(): Promise<void> {
    this.entries = await readJson<StoredEntry[]>(path.join(this.directory, 'index.json'), []);
    if (
      !Array.isArray(this.entries) ||
      this.entries.some(
        (entry) =>
          !/^[\da-f-]{36}$/.test(entry.id) ||
          !Array.isArray(entry.images) ||
          entry.images.some((image) => !/^[\da-f]{64}$/.test(image.blob)),
      )
    )
      throw new Error('历史索引损坏，原文件已保留');
  }

  async snapshot(file: string, content: string, reason: string, coalesce = false): Promise<void> {
    const contentHash = hash(content);
    const latest = this.entries
      .filter((entry) => entry.path === file)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest?.contentHash === contentHash && reason !== '恢复前') return;
    const images: ImageCopy[] = [];
    for (const link of extractLinks(content).filter((link) => link.image)) {
      if (
        /^[a-z][a-z\d+.-]*:/i.test(link.target) &&
        !path.isAbsolute(link.target) &&
        !link.target.startsWith('file:')
      )
        continue;
      try {
        const original = await this.options.resolveAsset(link.target, file);
        if (
          !imageExtensions.has(path.extname(original).toLowerCase()) ||
          images.some((image) => image.original === original)
        )
          continue;
        const bytes = await readFile(original);
        const blob = hash(bytes);
        if (!(await readOptional(this.blobPath(blob))))
          await atomicWrite(this.blobPath(blob), bytes);
        images.push({ original, blob, bytes: bytes.length });
      } catch (error) {
        if (!isMissing(error) && error instanceof Error && !/授权/.test(error.message)) throw error;
      }
    }
    const now = Math.max(this.options.now(), (latest?.createdAt ?? 0) + 1);
    const replace =
      coalesce &&
      latest &&
      !latest.pinned &&
      latest.reason === reason &&
      now - latest.createdAt < 30_000
        ? latest
        : undefined;
    const entry: StoredEntry = {
      id: replace?.id ?? randomUUID(),
      path: file,
      createdAt: now,
      pinned: false,
      reason,
      textBytes: Buffer.byteLength(content),
      imageBytes: images.reduce((total, image) => total + image.bytes, 0),
      images,
      contentHash,
    };
    await atomicWrite(this.textPath(entry.id), content);
    this.entries = this.entries.filter((item) => item.id !== replace?.id);
    this.entries.push(entry);
    await this.persist();
  }

  list(file?: string): HistoryEntry[] {
    return this.entries
      .filter((entry) => !file || entry.path === file)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ images: _images, contentHash: _hash, ...entry }) => entry);
  }
  async read(id: string): Promise<{ content: string; entry: HistoryEntry }> {
    const found = this.entries.find((entry) => entry.id === id);
    if (!found) throw new Error('历史版本不存在');
    const { images: _images, contentHash: _hash, ...entry } = found;
    return { content: await readFile(this.textPath(id), 'utf8'), entry };
  }
  async imageCopies(id: string): Promise<{ original: string; bytes: Buffer }[]> {
    const found = this.entries.find((entry) => entry.id === id);
    if (!found) throw new Error('历史版本不存在');
    return Promise.all(
      found.images.map(async (image) => ({
        original: image.original,
        bytes: await readFile(this.blobPath(image.blob)),
      })),
    );
  }
  async pin(id: string, pinned: boolean): Promise<void> {
    const entry = this.entries.find((entry) => entry.id === id);
    if (!entry) throw new Error('历史版本不存在');
    entry.pinned = pinned;
    await this.persist();
  }
  async markDeleted(file: string): Promise<void> {
    for (const entry of this.entries) if (entry.path === file) entry.deletedAt = this.options.now();
    await this.persist();
  }
  async moved(from: string, to: string): Promise<void> {
    for (const entry of this.entries) if (entry.path === from) entry.path = to;
    await this.persist();
  }
  stats(warning?: string): HistoryStats {
    const textBytes = this.entries.reduce((total, entry) => total + entry.textBytes, 0);
    const images = new Map<string, number>();
    for (const entry of this.entries)
      for (const image of entry.images) images.set(image.blob, image.bytes);
    const imageBytes = [...images.values()].reduce((total, size) => total + size, 0);
    const totalBytes = textBytes + imageBytes;
    warning ??=
      totalBytes > this.options.settings().historyLimitMB * 1024 * 1024
        ? '受保护的历史版本超过容量限制，请调整容量或取消固定版本'
        : undefined;
    return {
      textBytes,
      imageBytes,
      totalBytes,
      count: this.entries.length,
      ...(warning ? { warning } : {}),
    };
  }
  async prune(): Promise<HistoryStats> {
    const settings = this.options.settings();
    const cutoff = this.options.now() - settings.historyDays * 86400_000;
    const deletedCutoff = this.options.now() - Math.min(settings.historyDays, 30) * 86400_000;
    const latest = new Map<string, string>();
    for (const entry of [...this.entries].sort((a, b) => a.createdAt - b.createdAt)) {
      try {
        if ((await stat(entry.path)).isFile()) {
          delete entry.deletedAt;
          latest.set(entry.path, entry.id);
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
        entry.deletedAt ??= this.options.now();
      }
    }
    const protectedEntry = (entry: StoredEntry): boolean =>
      !entry.deletedAt && (entry.pinned || latest.get(entry.path) === entry.id);
    const removed: StoredEntry[] = [];
    this.entries = this.entries.filter((entry) => {
      const expired = entry.deletedAt
        ? entry.deletedAt < deletedCutoff
        : entry.createdAt < cutoff && !protectedEntry(entry);
      if (expired) removed.push(entry);
      return !expired;
    });
    const limit = settings.historyLimitMB * 1024 * 1024;
    for (const entry of [...this.entries].sort((a, b) => a.createdAt - b.createdAt)) {
      if (this.stats().totalBytes <= limit) break;
      if (protectedEntry(entry)) continue;
      this.entries = this.entries.filter((item) => item.id !== entry.id);
      removed.push(entry);
    }
    // Persist references before deleting blobs so an interrupted prune cannot orphan a live entry.
    await this.persist();
    for (const entry of removed) await rm(this.textPath(entry.id), { force: true });
    const used = new Set(this.entries.flatMap((entry) => entry.images.map((image) => image.blob)));
    await mkdir(path.join(this.directory, 'images'), { recursive: true });
    for (const name of await readdir(path.join(this.directory, 'images')))
      if (/^[\da-f]{64}$/.test(name) && !used.has(name))
        await rm(this.blobPath(name), { force: true });
    return this.stats(
      this.stats().totalBytes > limit
        ? '受保护的历史版本超过容量限制，请调整容量或取消固定版本'
        : undefined,
    );
  }
}
