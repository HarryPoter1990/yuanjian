import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MoveOutcome, NoteMeta } from '../../src/shared/types';
import { atomicWrite, hash, readOptional, readJson, writeJson } from './io';
import { z } from 'zod';
import { moveExclusive, type NoteStore } from './store';
import { noteExtensions } from './adapters';
import { linkTargetRanges } from './markdown-ranges';

interface Rewrite {
  originalPath: string;
  finalPath: string;
  before: Buffer;
  after: Buffer;
}
interface MoveRecord {
  from: string;
  to: string;
  rewrites: Rewrite[];
  direction: 'moved' | 'undone';
  history?: {
    from: string;
    to: string;
    expected: Buffer;
    snapshots: { path: string; expected: Buffer }[];
  };
}
export class MoveStore {
  private readonly undoRecords = new Map<string, MoveRecord>();
  constructor(private readonly store: NoteStore) {}
  async initialize(): Promise<void> {
    const file = z.string().refine(path.isAbsolute);
    const bytes = z.string().max(128 * 1024 * 1024);
    const records = z
      .array(
        z.object({
          id: z.string().uuid(),
          from: file,
          to: file,
          direction: z.enum(['moved', 'undone']),
          history: z.object({
            from: file,
            to: file,
            expected: bytes,
            snapshots: z.array(z.object({ path: file, expected: bytes })).max(10000),
          }),
        }),
      )
      .max(10000)
      .parse(await readJson(path.join(this.store.dataDirectory, 'pending-move-history.json'), []));
    for (const record of records)
      this.undoRecords.set(record.id, {
        ...record,
        rewrites: [],
        history: {
          ...record.history,
          expected: Buffer.from(record.history.expected, 'base64'),
          snapshots: record.history.snapshots.map((item) => ({
            ...item,
            expected: Buffer.from(item.expected, 'base64'),
          })),
        },
      });
  }
  pendingHistory(): { id: string; label: string }[] {
    return [...this.undoRecords]
      .filter(([, record]) => record.history)
      .map(([id, record]) => ({
        id,
        label: `移动历史 · ${path.basename(record.direction === 'moved' ? record.to : record.from)}`,
      }));
  }
  private async persistPending(): Promise<void> {
    await writeJson(
      path.join(this.store.dataDirectory, 'pending-move-history.json'),
      [...this.undoRecords].flatMap(([id, record]) =>
        record.history
          ? [
              {
                id,
                from: record.from,
                to: record.to,
                direction: record.direction,
                history: {
                  ...record.history,
                  expected: record.history.expected.toString('base64'),
                  snapshots: record.history.snapshots.map((item) => ({
                    ...item,
                    expected: item.expected.toString('base64'),
                  })),
                },
              },
            ]
          : [],
      ),
    );
  }

  private async finishHistory(record: MoveRecord): Promise<void> {
    const pending = record.history;
    if (!pending) return;
    const currentText = async (file: string, expected: Buffer): Promise<string> => {
      const note = await this.store.readNote(file);
      if (note.path !== file) throw new Error('移动后的笔记位置已变化，无法确认原笔记');
      const bytes = await this.store.readAuthorizedFile(file);
      if (hash(bytes) !== note.hash) throw new Error('历史补记期间文件已变化，请重试');
      const content = bytes.toString('utf8');
      if (!bytes.equals(expected) && !this.store.history.hasSnapshotContent(file, content))
        throw new Error('文件内容已变化且缺少可核对的保存历史，无法确认原笔记，请先在当前位置核对');
      return content;
    };
    await currentText(pending.to, pending.expected);
    const snapshots: { path: string; content: string }[] = [];
    for (const snapshot of pending.snapshots)
      snapshots.push({
        path: snapshot.path,
        content: await currentText(snapshot.path, snapshot.expected),
      });
    // Mapping is idempotent and persists in-memory entries left by a failed snapshot write.
    await this.store.history.moved(pending.from, pending.to);
    for (const snapshot of snapshots)
      await this.store.history.snapshot(snapshot.path, snapshot.content, '移动修复后');
  }
  private async finishAndPersist(record: MoveRecord): Promise<void> {
    await this.finishHistory(record);
    const pending = record.history;
    record.history = undefined;
    try { await this.persistPending(); }
    catch (error) { record.history = pending; throw error; }
  }

  private async completion(id: string, record: MoveRecord): Promise<MoveOutcome> {
    let historyWarning: string | undefined;
    try {
      await this.finishAndPersist(record);
    } catch (error) {
      historyWarning = `文件操作已完成，但历史记录尚未完成：${error instanceof Error ? error.message : String(error)}`;
    }
    if (historyWarning) try { await this.persistPending(); } catch { historyWarning += '；补记状态未持久化，请退出前重试'; }
    return {
      path: record.direction === 'moved' ? record.to : record.from,
      affected: record.rewrites
        .filter((item) => item.originalPath !== record.from)
        .map((item) => item.finalPath),
      undoId: id,
      ...(historyWarning ? { historyWarning, historyRetryId: id } : {}),
    };
  }

  async retryHistory(id: string): Promise<void> {
    return this.store.queue.run(async () => {
      const record = this.undoRecords.get(id);
      if (!record) throw new Error('此移动历史重试记录已失效');
      await this.finishAndPersist(record);
      if (record.direction === 'undone') this.undoRecords.delete(id);
    });
  }

  private async rewrite(
    content: string,
    source: string,
    nextSource: string,
    from: string,
    to: string,
    index: NoteMeta[],
    preservedImages?: ReadonlySet<string>,
  ): Promise<string> {
    const tokens = linkTargetRanges(content);
    let rewritten = content;
    for (const token of tokens.reverse()) {
      if (token.image && preservedImages?.has(token.target)) continue;
      const wiki = token.wiki;
      const raw = token.target;
      if (!raw || /^#|^[a-z][a-z\d+.-]*:/i.test(raw)) continue;
      const [filePart, ...fragment] = raw.split('#');
      const suffix = fragment.length ? `#${fragment.join('#')}` : '';
      let decoded = filePart;
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        /* keep literal */
      }
      let target = path.resolve(path.dirname(source), decoded);
      if (!wiki && !path.extname(decoded) && index.some((item) => item.path === `${target}.md`))
        target += '.md';
      if (wiki) {
        const direct = [target, `${target}.md`];
        const candidate = index.find((item) => direct.includes(item.path));
        if (candidate) target = candidate.path;
        else if (direct.includes(from)) target = from;
        else {
          const key = decoded.replace(/\\/g, '/').replace(/\.md$/i, '').toLocaleLowerCase();
          const matches = index.filter((item) =>
            item.path
              .replace(/\\/g, '/')
              .replace(/\.md$/i, '')
              .toLocaleLowerCase()
              .endsWith(`/${key}`),
          );
          if (matches.length !== 1) continue;
          target = matches[0].path;
        }
      }
      const changedTarget = target === from ? to : target;
      if (target !== from && source === nextSource) continue;
      let replacement = path
        .relative(path.dirname(nextSource), changedTarget)
        .split(path.sep)
        .join('/');
      // Keep non-ASCII characters readable, while safely encoding delimiters and spaces.
      if (wiki) replacement = replacement.replace(/\.md$/i, '');
      else
        replacement = replacement
          .replace(/ /g, '%20')
          .replace(/\(/g, '%28')
          .replace(/\)/g, '%29')
          .replace(/#/g, '%23');
      replacement += suffix;
      rewritten = rewritten.slice(0, token.from) + replacement + rewritten.slice(token.to);
    }
    return rewritten;
  }
  async rebase(
    content: string,
    from: string,
    to: string,
    preservedImages: ReadonlySet<string>,
  ): Promise<string> {
    if (from === to) return content;
    return this.rewrite(content, from, to, from, to, await this.store.getIndex(), preservedImages);
  }
  async move(from: string, destination?: string): Promise<MoveOutcome | null> {
    from = await this.store.authorize(from);
    let to = destination;
    if (!to) {
      to = (await this.store.adapters.saveFile?.(from)) ?? undefined;
      if (!to) return null;
      await this.store.approveFile(to);
    }
    to = await this.store.authorize(to);
    const finalTo = to;
    if (from === finalTo) throw new Error('新旧路径相同');
    if (!(await stat(from)).isFile()) throw new Error('只支持移动单个文件');
    if (
      !noteExtensions.has(path.extname(from).toLowerCase()) ||
      !noteExtensions.has(path.extname(finalTo).toLowerCase())
    )
      throw new Error('笔记移动必须保留 Markdown 扩展名');
    return this.store.queue.run(async () => {
      if (await readOptional(finalTo)) throw new Error('目标文件已经存在');
      const index = await this.store.getIndex();
      if (!index.some((item) => item.path === from)) {
        const note = await this.store.readNote(from);
        index.push({
          path: from,
          title: note.title,
          tags: [],
          headings: [],
          links: [],
          modifiedAt: note.modifiedAt,
        });
      }
      const rewrites: Rewrite[] = [];
      for (const meta of index) {
        const before = await readFile(meta.path);
        const finalPath = meta.path === from ? finalTo : meta.path;
        const after = Buffer.from(
          await this.rewrite(before.toString('utf8'), meta.path, finalPath, from, finalTo, index),
        );
        if (!before.equals(after) || meta.path === from)
          rewrites.push({ originalPath: meta.path, finalPath, before, after });
      }
      // Refuse to apply a prepared rewrite if another editor has changed any input meanwhile.
      for (const rewrite of rewrites)
        if (hash(await readFile(rewrite.originalPath)) !== hash(rewrite.before))
          throw new Error('移动准备期间文件被修改，请重试');
      const written: Rewrite[] = [];
      let moved = false;
      try {
        for (const rewrite of rewrites)
          if (!rewrite.before.equals(rewrite.after))
            await this.store.history.snapshot(
              rewrite.originalPath,
              rewrite.before.toString('utf8'),
              '移动修复前',
            );
        // Backing up image history can take time; recheck after it before moving any source.
        for (const rewrite of rewrites)
          if (hash(await readFile(rewrite.originalPath)) !== hash(rewrite.before))
            throw new Error('移动备份期间文件被修改，请重试');
        await mkdir(path.dirname(finalTo), { recursive: true });
        await moveExclusive(from, finalTo);
        moved = true;
        for (const rewrite of rewrites) {
          const current = await readOptional(rewrite.finalPath);
          if (!current || hash(current) !== hash(rewrite.before))
            throw new Error('移动期间文件被其他程序修改，已中止引用修复');
          await atomicWrite(rewrite.finalPath, rewrite.after);
          written.push(rewrite);
        }
      } catch (error) {
        for (const rewrite of written.reverse()) {
          const current = await readOptional(rewrite.finalPath);
          if (current && hash(current) === hash(rewrite.after))
            await atomicWrite(rewrite.finalPath, rewrite.before);
        }
        if (moved) await moveExclusive(finalTo, from);
        throw error;
      }
      const undoId = randomUUID();
      const record: MoveRecord = {
        from,
        to: finalTo,
        rewrites,
        direction: 'moved',
        history: {
          from,
          to: finalTo,
          expected: rewrites.find((rewrite) => rewrite.originalPath === from)!.after,
          snapshots: rewrites
            .filter((rewrite) => !rewrite.before.equals(rewrite.after))
            .map((rewrite) => ({
              path: rewrite.finalPath,
              expected: rewrite.after,
            })),
        },
      };
      this.undoRecords.set(undoId, record);
      const affected = rewrites
        .filter((item) => item.originalPath !== from)
        .map((item) => item.finalPath);
      this.store.changed([from, finalTo, ...affected]);
      return this.completion(undoId, record);
    });
  }
  async undo(id: string): Promise<MoveOutcome> {
    return this.store.queue.run(async () => {
      const record = this.undoRecords.get(id);
      if (!record) throw new Error('此移动撤销记录已失效');
      if (!record.rewrites.length) throw new Error('重启后的记录仅支持历史补记，不能撤销移动');
      if (record.direction === 'undone')
        throw new Error('此移动已撤销，请仅重试尚未完成的历史记录');
      if (await readOptional(record.from)) throw new Error('原位置已出现其他文件，无法撤销');
      for (const rewrite of record.rewrites) {
        const current = await readOptional(await this.store.authorize(rewrite.finalPath));
        if (!current || hash(current) !== hash(rewrite.after))
          throw new Error('移动后文件已有修改，无法安全撤销');
      }
      const restored: Rewrite[] = [];
      let moved = false;
      try {
        for (const rewrite of record.rewrites) {
          await atomicWrite(rewrite.finalPath, rewrite.before);
          restored.push(rewrite);
        }
        await moveExclusive(record.to, record.from);
        moved = true;
      } catch (error) {
        if (!moved)
          for (const rewrite of restored) await atomicWrite(rewrite.finalPath, rewrite.after);
        throw error;
      }
      record.direction = 'undone';
      record.history = {
        from: record.to,
        to: record.from,
        expected: record.rewrites.find((rewrite) => rewrite.originalPath === record.from)!.before,
        snapshots: [],
      };
      this.store.changed([
        record.from,
        record.to,
        ...record.rewrites.map((item) => item.originalPath),
      ]);
      const outcome = await this.completion(id, record);
      if (!record.history) this.undoRecords.delete(id);
      return outcome;
    });
  }
}
