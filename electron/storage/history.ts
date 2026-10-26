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
  targets?: string[];
}
interface StoredEntry extends HistoryEntry {
  images: ImageCopy[];
  contentHash: string;
  sourcePath?: string;
}
interface HistoryOptions {
  directory: string;
  settings: () => Settings;
  resolveAsset: (target: string, from: string) => Promise<string>;
  now: () => number;
}

export class HistoryStore {
  private entries: StoredEntry[] = [];
  private prepared: StoredEntry[] = [];
  private durablePrepared = new Set<string>();
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
  private async persist(entries = this.entries): Promise<void> {
    await writeJson(path.join(this.directory, 'index.json'), entries);
    this.entries = entries;
  }
  async initialize(): Promise<void> {
    this.entries = await readJson<StoredEntry[]>(path.join(this.directory, 'index.json'), []);
    this.prepared = await readJson<StoredEntry[]>(
      path.join(this.directory, 'pending-snapshots.json'),
      [],
    );
    if (
      !Array.isArray(this.entries) ||
      !Array.isArray(this.prepared) ||
      [...this.entries, ...this.prepared].some(
        (entry) =>
          !/^[\da-f-]{36}$/.test(entry.id) ||
          (entry.sourcePath !== undefined &&
            (typeof entry.sourcePath !== 'string' || !path.isAbsolute(entry.sourcePath))) ||
          !Array.isArray(entry.images) ||
          entry.images.some(
            (image) =>
              !/^[\da-f]{64}$/.test(image.blob) ||
              (image.targets !== undefined &&
                (!Array.isArray(image.targets) ||
                  image.targets.some((target) => typeof target !== 'string'))),
          ),
      )
    )
      throw new Error('历史索引损坏，原文件已保留');
    this.durablePrepared = new Set(this.prepared.map((entry) => entry.id));
  }

  async snapshot(file: string, content: string, reason: string, coalesce = false, createdAt?: number): Promise<void> {
    const contentHash = hash(content);
    const prepared = this.prepared.find(
      (entry) => entry.path === file && entry.contentHash === contentHash,
    );
    const latest = this.entries
      .filter((entry) => entry.path === file)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (
      (prepared && this.entries.some((entry) => entry.id === prepared.id)) ||
      (latest?.contentHash === contentHash && reason !== '恢复前')
    ) {
      if (prepared) await this.clearPrepared(prepared);
      return;
    }
    if (prepared) {
      const replace =
        coalesce &&
        latest &&
        !latest.pinned &&
        latest.reason === prepared.reason &&
        prepared.createdAt >= latest.createdAt &&
        prepared.createdAt - latest.createdAt < 30_000
          ? latest
          : undefined;
      await this.persist([...this.entries.filter((entry) => entry.id !== replace?.id), prepared]);
      await this.clearPrepared(prepared);
      if (replace) await rm(this.textPath(replace.id), { force: true }).catch(() => undefined);
      return;
    }
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
        if (!imageExtensions.has(path.extname(original).toLowerCase())) continue;
        const existing = images.find((image) => image.original === original);
        if (existing) {
          const targets = (existing.targets ??= []);
          if (!targets.includes(link.target)) targets.push(link.target);
          continue;
        }
        const bytes = await readFile(original);
        const blob = hash(bytes);
        if (!(await readOptional(this.blobPath(blob))))
          await atomicWrite(this.blobPath(blob), bytes);
        images.push({ original, blob, bytes: bytes.length, targets: [link.target] });
      } catch (error) {
        if (!isMissing(error) && error instanceof Error && !/授权/.test(error.message)) throw error;
      }
    }
    const now = createdAt ?? Math.max(this.options.now(), (latest?.createdAt ?? 0) + 1);
    const replace =
      coalesce &&
      latest &&
      !latest.pinned &&
      latest.reason === reason &&
      now >= latest.createdAt &&
      now - latest.createdAt < 30_000
        ? latest
        : undefined;
    const entry: StoredEntry = {
      // A new text file keeps the last committed index valid if publishing the new index fails.
      id: randomUUID(),
      path: file,
      sourcePath: file,
      createdAt: now,
      pinned: false,
      reason,
      textBytes: Buffer.byteLength(content),
      imageBytes: images.reduce((total, image) => total + image.bytes, 0),
      images,
      contentHash,
    };
    await atomicWrite(this.textPath(entry.id), content);
    try {
      await this.persist([...this.entries.filter((item) => item.id !== replace?.id), entry]);
    } catch (error) {
      // Keep the captured image blobs as well as the text; retry must not recapture newer images.
      this.prepared.push(entry);
      try {
        await writeJson(path.join(this.directory, 'pending-snapshots.json'), this.prepared);
        this.durablePrepared = new Set(this.prepared.map((item) => item.id));
      } catch { /* The caller reports that only the in-memory capture is available. */ }
      throw error;
    }
    if (replace) await rm(this.textPath(replace.id), { force: true }).catch(() => undefined);
  }
  hasPrepared(file: string, content: string): boolean {
    return this.prepared.some(
      (entry) => entry.path === file && entry.contentHash === hash(content) && this.durablePrepared.has(entry.id),
    );
  }
  private async clearPrepared(entry: StoredEntry): Promise<void> {
    const next = this.prepared.filter((item) => item.id !== entry.id);
    await writeJson(path.join(this.directory, 'pending-snapshots.json'), next);
    this.prepared = next;
    this.durablePrepared.delete(entry.id);
  }

  list(file?: string): HistoryEntry[] {
    return this.entries
      .filter((entry) => !file || entry.path === file)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ images: _images, contentHash: _hash, sourcePath: _sourcePath, ...entry }) => entry);
  }
  hasSnapshotContent(file: string, content: string): boolean {
    const contentHash = hash(content);
    return this.entries.some((entry) => entry.path === file && entry.contentHash === contentHash);
  }
  async read(id: string): Promise<{ content: string; entry: HistoryEntry }> {
    const found = this.entries.find((entry) => entry.id === id);
    if (!found) throw new Error('历史版本不存在');
    const { images: _images, contentHash: _hash, sourcePath: _sourcePath, ...entry } = found;
    return { content: await readFile(this.textPath(id), 'utf8'), entry };
  }
  sourcePath(id: string): string | undefined {
    const found = this.entries.find((entry) => entry.id === id);
    if (!found) throw new Error('历史版本不存在');
    return found.sourcePath;
  }
  async imageCopies(id: string): Promise<{ original: string; bytes: Buffer; targets: string[] }[]> {
    const found = this.entries.find((entry) => entry.id === id);
    if (!found) throw new Error('历史版本不存在');
    return Promise.all(
      found.images.map(async (image) => ({
        original: image.original,
        bytes: await readFile(this.blobPath(image.blob)),
        targets: image.targets ?? [],
      })),
    );
  }
  async pin(id: string, pinned: boolean): Promise<void> {
    const entry = this.entries.find((entry) => entry.id === id);
    if (!entry) throw new Error('历史版本不存在');
    await this.persist(this.entries.map((item) => (item.id === id ? { ...item, pinned } : item)));
  }
  async markDeleted(file: string): Promise<void> {
    await this.persist(
      this.entries.map((entry) =>
        entry.path === file ? { ...entry, deletedAt: this.options.now() } : entry,
      ),
    );
  }
  async moved(from: string, to: string): Promise<void> {
    await this.persist(
      this.entries.map((entry) =>
        entry.path === from ? { ...entry, sourcePath: entry.sourcePath ?? from, path: to } : entry,
      ),
    );
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
    let next = this.entries.map((entry) => ({ ...entry }));
    const settings = this.options.settings();
    const cutoff = this.options.now() - settings.historyDays * 86400_000;
    const deletedCutoff = this.options.now() - Math.min(settings.historyDays, 30) * 86400_000;
    const latest = new Map<string, string>();
    for (const entry of [...next].sort((a, b) => a.createdAt - b.createdAt)) {
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
    next = next.filter((entry) => {
      const expired = entry.deletedAt
        ? entry.deletedAt < deletedCutoff
        : entry.createdAt < cutoff && !protectedEntry(entry);
      if (expired) removed.push(entry);
      return !expired;
    });
    const limit = settings.historyLimitMB * 1024 * 1024;
    for (const entry of [...next].sort((a, b) => a.createdAt - b.createdAt)) {
      const bytes =
        next.reduce((sum, item) => sum + item.textBytes, 0) +
        [
          ...new Map(
            next.flatMap((item) => item.images.map((image) => [image.blob, image.bytes] as const)),
          ).values(),
        ].reduce((sum, size) => sum + size, 0);
      if (bytes <= limit) break;
      if (protectedEntry(entry)) continue;
      next = next.filter((item) => item.id !== entry.id);
      removed.push(entry);
    }
    // Persist references before deleting blobs so an interrupted prune cannot orphan a live entry.
    await this.persist(next);
    for (const entry of removed) await rm(this.textPath(entry.id), { force: true });
    const used = new Set(
      [...this.entries, ...this.prepared].flatMap((entry) =>
        entry.images.map((image) => image.blob),
      ),
    );
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
