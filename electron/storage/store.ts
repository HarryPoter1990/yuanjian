import { copyFile, link, mkdir, readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diff3Merge, diffComm } from 'node-diff3';
import { defaultSettings } from '../../src/shared/defaults';
import { extractLinks, parseNote, setFrontmatterTags } from '../../src/shared/markdown';
import type {
  AttachmentCandidate,
  FileEntry,
  HistoryEntry,
  HistoryStats,
  LocalizationResult,
  MoveOutcome,
  NoteDocument,
  NoteMeta,
  ResolvedLink,
  SaveOutcome,
  SaveRequest,
  SearchHit,
  SessionState,
  Settings,
} from '../../src/shared/types';
import { PathAccess, canonical, within } from './access';
import { imageExtensions, noteExtensions, type StoreAdapters } from './adapters';
import {
  atomicWrite,
  hash,
  isMissing,
  OperationQueue,
  readJson,
  readOptional,
  writeJson,
} from './io';
import { HistoryStore } from './history';
import { AttachmentStore } from './attachments';
import { MoveStore } from './move';

const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
interface SavedFormat {
  bom: boolean;
  newline: '\r\n' | '\n';
}

function normalizedLocalLink(target: string): { file: string; heading: string; key: string } {
  const raw = target
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    .trim();
  const separator = raw.indexOf('#');
  let file: string;
  let heading: string;
  try {
    file = decodeURIComponent(separator < 0 ? raw : raw.slice(0, separator));
    heading = decodeURIComponent(separator < 0 ? '' : raw.slice(separator + 1));
  } catch {
    throw new Error('链接地址编码无效');
  }
  const key = `${file.replace(/\\/g, '/')}#${heading}`;
  return { file, heading, key: process.platform === 'win32' ? key.toLocaleLowerCase() : key };
}
export class NoteStore {
  readonly access = new PathAccess();
  readonly queue = new OperationQueue();
  readonly history: HistoryStore;
  readonly attachments: AttachmentStore;
  readonly moves: MoveStore;
  readonly now: () => number;
  private settings: Settings = structuredClone(defaultSettings);
  private session: SessionState = { tabs: [], activeId: null };
  private readonly formats = new Map<string, SavedFormat>();
  private readonly baseline = new Set<string>();
  private initialized = false;

  constructor(
    readonly dataDirectory: string,
    readonly adapters: StoreAdapters = {},
  ) {
    this.now = adapters.now ?? Date.now;
    this.history = new HistoryStore({
      directory: dataDirectory,
      settings: () => this.settings,
      now: this.now,
      resolveAsset: (target, from) => this.resolveAssetPath(target, from),
    });
    this.attachments = new AttachmentStore(this);
    this.moves = new MoveStore(this);
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dataDirectory, { recursive: true });
    const saved = await readJson<Partial<Settings>>(
      path.join(this.dataDirectory, 'settings.json'),
      {},
    );
    this.settings = {
      ...structuredClone(defaultSettings),
      ...saved,
      appearance: { ...defaultSettings.appearance, ...saved.appearance },
      graph: { ...structuredClone(defaultSettings.graph), ...saved.graph },
    };
    // Earlier versions stored individual colors; never replace them with a new built-in palette.
    if (saved.appearance && !Object.hasOwn(saved.appearance, 'palette'))
      this.settings.appearance.palette = undefined;
    this.access.excluded = this.settings.excluded;
    const validRoots: string[] = [];
    for (const root of this.settings.roots) {
      try {
        validRoots.push(await this.access.approveDirectory(root));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    this.settings.roots = validRoots;
    for (const wallpaper of [
      this.settings.appearance.wallpaper,
      ...this.settings.themes.map((theme) => theme.appearance.wallpaper),
    ]) {
      if (wallpaper && !wallpaper.startsWith('data:')) await this.access.approveFile(wallpaper);
    }
    if (this.settings.journalDirectory) {
      try {
        this.settings.journalDirectory = await this.access.approveDirectory(
          this.settings.journalDirectory,
        );
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    this.session = await readJson<SessionState>(path.join(this.dataDirectory, 'session.json'), {
      tabs: [],
      activeId: null,
    });
    if (!Array.isArray(this.session.tabs)) throw new Error('会话文件损坏，原文件已保留');
    for (const tab of this.session.tabs) if (tab.path) await this.access.approveFile(tab.path);
    await this.history.initialize();
    await this.history.prune();
    this.initialized = true;
  }
  getSettings(): Settings {
    return structuredClone(this.settings);
  }
  getSession(): SessionState {
    return structuredClone(this.session);
  }
  getRoots(): string[] {
    return [...this.settings.roots];
  }
  getApprovedPaths(): { directories: string[]; files: string[] } {
    return { directories: [...this.access.directories], files: [...this.access.files] };
  }
  approveFile(file: string): Promise<string> {
    return this.access.approveFile(file);
  }
  approveDirectory(directory: string): Promise<string> {
    return this.access.approveDirectory(directory);
  }
  authorize(file: string): Promise<string> {
    return this.access.assert(file);
  }
  async readAuthorizedFile(file: string): Promise<Buffer> {
    return readFile(await this.authorize(file));
  }
  changed(files: string[]): void {
    this.adapters.changed?.(files);
  }
  async dispose(): Promise<void> {
    await this.queue.flush();
  }

  async saveSettings(settings: Settings): Promise<Settings> {
    const approvedRoots = await Promise.all(
      settings.roots.map((root) => this.access.assertDirectory(root)),
    );
    if (settings.journalDirectory) await this.access.assertDirectory(settings.journalDirectory);
    for (const wallpaper of [
      settings.appearance.wallpaper,
      ...settings.themes.map((theme) => theme.appearance.wallpaper),
    ]) {
      if (wallpaper && !wallpaper.startsWith('data:')) await this.authorize(wallpaper);
    }
    if (
      !Number.isFinite(settings.historyDays) ||
      settings.historyDays < 1 ||
      settings.historyDays > 36500 ||
      !Number.isFinite(settings.historyLimitMB) ||
      settings.historyLimitMB < 1
    )
      throw new Error('历史保留天数与容量必须为正数');
    if (
      path.isAbsolute(settings.attachmentPattern) ||
      settings.attachmentPattern.split(/[\\/]/).includes('..')
    )
      throw new Error('附件目录必须位于笔记所在目录内');
    return this.queue.run(async () => {
      const next = structuredClone({ ...settings, roots: [...new Set(approvedRoots)] });
      await writeJson(path.join(this.dataDirectory, 'settings.json'), next);
      this.settings = next;
      this.access.excluded = next.excluded;
      return this.getSettings();
    });
  }
  async saveSession(session: SessionState): Promise<void> {
    if (!Array.isArray(session.tabs) || session.tabs.length > 200)
      throw new Error('会话标签数量异常');
    for (const tab of session.tabs) {
      if (tab.path) await this.authorize(tab.path);
      if (Buffer.byteLength(tab.content) > MAX_DOCUMENT_BYTES) throw new Error('草稿超过大小限制');
    }
    return this.queue.run(async () => {
      await writeJson(path.join(this.dataDirectory, 'session.json'), session);
      this.session = structuredClone(session);
    });
  }
  async selectDirectory(): Promise<string | null> {
    const selected = await this.adapters.selectDirectory?.();
    return selected ? this.approveDirectory(selected) : null;
  }
  async openFile(candidate?: string): Promise<NoteDocument | null> {
    let file = candidate;
    if (!file) {
      file = (await this.adapters.openFile?.()) ?? undefined;
      if (!file) return null;
      await this.approveFile(file);
    }
    file = await this.authorize(file);
    if (!noteExtensions.has(path.extname(file).toLowerCase()))
      throw new Error('请选择 Markdown 文件');
    return this.readNote(file);
  }
  async readNote(file: string): Promise<NoteDocument> {
    file = await this.authorize(file);
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES)
      throw new Error('文件不是普通笔记或超过 64 MiB 限制');
    const bytes = await readFile(file);
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const bom = decoded.startsWith('\ufeff');
    const content = bom ? decoded.slice(1) : decoded;
    this.formats.set(file, { bom, newline: content.includes('\r\n') ? '\r\n' : '\n' });
    return {
      id: file,
      path: file,
      title: path.basename(file, path.extname(file)),
      content,
      hash: hash(bytes),
      modifiedAt: info.mtimeMs,
    };
  }
  private encode(file: string, content: string, reference?: string): string {
    const format = this.formats.get(file);
    let normalized = content;
    if (reference !== undefined && !reference.includes('\r\n')) {
      normalized = content.replace(/\r\n/g, '\n');
    } else if (reference !== undefined && !/(^|[^\r])\n/.test(reference)) {
      normalized = content.replace(/\r?\n/g, '\r\n');
    } else if (reference !== undefined) {
      const oldLines = reference.split(/\r?\n/);
      const oldEndings = reference.match(/\r\n|\n/g) ?? [];
      const newLines = content.split(/\r?\n/);
      const endings = new Map<number, string>();
      let oldIndex = 0;
      let newIndex = 0;
      // Trim unchanged edges before LCS. Repeated prose otherwise creates a quadratic
      // matching problem even when the user only appends a few characters at the end.
      while (
        oldIndex < oldLines.length &&
        newIndex < newLines.length &&
        oldLines[oldIndex] === newLines[newIndex]
      ) {
        if (oldEndings[oldIndex]) endings.set(newIndex, oldEndings[oldIndex]);
        oldIndex++;
        newIndex++;
      }
      let suffix = 0;
      while (
        oldLines.length - suffix > oldIndex &&
        newLines.length - suffix > newIndex &&
        oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
      ) {
        suffix++;
      }
      for (const region of diffComm(
        oldLines.slice(oldIndex, oldLines.length - suffix),
        newLines.slice(newIndex, newLines.length - suffix),
      )) {
        if (region.common) {
          for (let index = 0; index < region.common.length; index++)
            if (oldEndings[oldIndex + index])
              endings.set(newIndex + index, oldEndings[oldIndex + index]);
          oldIndex += region.common.length;
          newIndex += region.common.length;
        } else {
          for (
            let index = 0;
            index < Math.min(region.buffer1.length, region.buffer2.length);
            index++
          )
            if (oldEndings[oldIndex + index])
              endings.set(newIndex + index, oldEndings[oldIndex + index]);
          oldIndex += region.buffer1.length;
          newIndex += region.buffer2.length;
        }
      }
      for (let index = 0; index < suffix; index++) {
        if (oldEndings[oldIndex + index])
          endings.set(newIndex + index, oldEndings[oldIndex + index]);
      }
      normalized = newLines
        .map(
          (line, index) =>
            line +
            (index < newLines.length - 1 ? (endings.get(index) ?? format?.newline ?? '\n') : ''),
        )
        .join('');
    } else if (format?.newline === '\r\n') normalized = content.replace(/\r?\n/g, '\r\n');
    return `${format?.bom && !normalized.startsWith('\ufeff') ? '\ufeff' : ''}${normalized}`;
  }
  private decode(bytes: Buffer): string {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.startsWith('\ufeff') ? text.slice(1) : text;
  }
  private conflict(
    file: string,
    request: SaveRequest,
    theirs: string,
    currentHash: string,
  ): SaveOutcome {
    return {
      status: 'conflict',
      conflict: {
        path: file,
        base: request.baseContent,
        ours: request.content,
        theirs,
        hash: currentHash,
      },
    };
  }
  async saveFile(request: SaveRequest): Promise<SaveOutcome> {
    if (Buffer.byteLength(request.content) > MAX_DOCUMENT_BYTES)
      throw new Error('笔记超过 64 MiB 限制');
    let candidate = request.path;
    let newFile = false;
    if (!candidate) {
      candidate = (await this.adapters.saveFile?.(`${request.title || '未命名'}.md`)) ?? null;
      if (!candidate) return { status: 'cancelled' };
      await this.approveFile(candidate);
      newFile = true;
    }
    const file = await this.authorize(candidate);
    if (!noteExtensions.has(path.extname(file).toLowerCase()))
      throw new Error('笔记必须保存为 Markdown 文件');
    return this.queue.run(async () => {
      const current = await readOptional(file);
      if (!current && request.hash && !newFile) return this.conflict(file, request, '', '');
      const currentHash = current ? hash(current) : '';
      const theirs = current ? this.decode(current) : '';
      if (current && !request.hash && !newFile && request.content !== theirs)
        return this.conflict(file, request, theirs, currentHash);
      if (current && !this.formats.has(file))
        this.formats.set(file, {
          bom: current.subarray(0, 3).equals(Buffer.from([239, 187, 191])),
          newline: theirs.includes('\r\n') ? '\r\n' : '\n',
        });
      let content = request.content;
      let merged = false;
      if (current && currentHash !== request.hash && !newFile && request.hash) {
        const normalize = (value: string): string[] => value.replace(/\r\n/g, '\n').split('\n');
        const result = diff3Merge(
          normalize(content),
          normalize(request.baseContent),
          normalize(theirs),
        );
        if (result.some((region) => 'conflict' in region))
          return this.conflict(file, request, theirs, currentHash);
        content = result.flatMap((region) => ('ok' in region ? region.ok : [])).join('\n');
        merged = true;
      } else if (
        current &&
        newFile &&
        request.hash !== currentHash &&
        theirs !== request.baseContent
      ) {
        return this.conflict(file, request, theirs, currentHash);
      }
      const encoded = this.encode(file, content, current ? theirs : undefined);
      if (current && hash(encoded) === currentHash)
        return { status: 'saved', note: await this.readNote(file), merged };
      if (current && !this.baseline.has(file)) {
        await this.history.snapshot(
          file,
          `${this.formats.get(file)?.bom ? '\ufeff' : ''}${theirs}`,
          '修改前基线',
        );
        this.baseline.add(file);
      }
      // Check again after potentially slow image backup, before atomically replacing the file.
      const latest = await readOptional(file);
      if ((latest ? hash(latest) : '') !== currentHash)
        return this.conflict(
          file,
          request,
          latest ? this.decode(latest) : '',
          latest ? hash(latest) : '',
        );
      await atomicWrite(file, encoded);
      await this.history.snapshot(file, encoded, '编辑后', true);
      await this.history.prune();
      this.changed([file]);
      return { status: 'saved', note: await this.readNote(file), merged };
    });
  }

  async getTree(root: string): Promise<FileEntry[]> {
    root = await this.access.assertDirectory(root);
    return this.walk(root, root);
  }
  private async walk(directory: string, root: string): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (this.access.isExcluded(root, file) || entry.isSymbolicLink()) continue;
      const real = await canonical(file);
      if (!within(root, real)) continue;
      if (entry.isDirectory()) {
        const children = await this.walk(real, root);
        if (children.length || this.settings.showAllFiles)
          entries.push({ path: real, name: entry.name, kind: 'directory', children });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const kind = noteExtensions.has(ext)
          ? 'note'
          : imageExtensions.has(ext) || ['.pdf', '.mp3', '.mp4', '.wav'].includes(ext)
            ? 'attachment'
            : 'other';
        if (kind !== 'other' || this.settings.showAllFiles)
          entries.push({ path: real, name: entry.name, kind });
      }
    }
    return entries.sort(
      (a, b) =>
        Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
        a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
    );
  }
  async getIndex(): Promise<NoteMeta[]> {
    const files = new Set<string>();
    const collect = (entries: FileEntry[]): void => {
      for (const entry of entries)
        if (entry.kind === 'note') files.add(entry.path);
        else if (entry.children) collect(entry.children);
    };
    for (const root of this.settings.roots) {
      try {
        collect(await this.getTree(root));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    const result: NoteMeta[] = [];
    for (const file of files) {
      try {
        const note = await this.readNote(file);
        result.push(parseNote(note.content, file, note.modifiedAt));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    return result;
  }
  async search(query: string, options: { root?: string; tag?: string } = {}): Promise<SearchHit[]> {
    if (!query.trim() && !options.tag) return [];
    const root = options.root ? await this.access.assertDirectory(options.root) : undefined;
    const queryLower = query.toLocaleLowerCase();
    const hits: SearchHit[] = [];
    for (const meta of await this.getIndex()) {
      if ((root && !within(root, meta.path)) || (options.tag && !meta.tags.includes(options.tag)))
        continue;
      const note = await this.readNote(meta.path);
      const lines = note.content.split(/\r?\n/);
      let found = false;
      lines.forEach((line, number) => {
        if (line.toLocaleLowerCase().includes(queryLower)) {
          hits.push({
            path: meta.path,
            title: meta.title,
            line: number + 1,
            snippet: line.slice(0, 400),
            tags: meta.tags,
          });
          found = true;
        }
      });
      if (!found && path.basename(meta.path).toLocaleLowerCase().includes(queryLower))
        hits.push({
          path: meta.path,
          title: meta.title,
          line: 1,
          snippet: lines[0] ?? '',
          tags: meta.tags,
        });
    }
    return hits.slice(0, 3000);
  }
  async resolveLink(fromPath: string, target: string): Promise<ResolvedLink> {
    fromPath = await this.authorize(fromPath);
    if (/^https?:\/\//i.test(target))
      return { path: null, exists: false, candidates: [], external: target };
    const [raw, heading] = target
      .replace(/^\[\[|\]\]$/g, '')
      .split('|')[0]
      .split('#');
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    if (!decoded) return { path: fromPath, heading, exists: true, candidates: [fromPath] };
    if (/^[a-z][a-z\d+.-]*:/i.test(decoded) && !path.isAbsolute(decoded))
      return { path: null, exists: false, candidates: [] };
    const direct = path.resolve(path.dirname(fromPath), decoded);
    const directOptions = path.extname(direct) ? [direct] : [direct, `${direct}.md`];
    for (const candidate of directOptions) {
      try {
        const allowed = await this.authorize(candidate);
        if ((await stat(allowed)).isFile())
          return { path: allowed, heading, exists: true, candidates: [allowed] };
      } catch (error) {
        if (!isMissing(error) && error instanceof Error && !/授权/.test(error.message)) throw error;
      }
    }
    const targetKey = decoded.replace(/\\/g, '/').replace(/\.md$/i, '').toLocaleLowerCase();
    const matches = (await this.getIndex())
      .filter((meta) => {
        const fileKey = meta.path.replace(/\\/g, '/').replace(/\.md$/i, '').toLocaleLowerCase();
        return fileKey.endsWith(`/${targetKey}`);
      })
      .map((meta) => meta.path);
    return {
      path: matches.length === 1 ? matches[0] : null,
      heading,
      exists: matches.length === 1,
      candidates: matches,
    };
  }

  /** An explicit user navigation grants only the Markdown file actually linked in its source. */
  async openLinkedFile(fromPath: string, target: string): Promise<NoteDocument | null> {
    const source = await this.readNote(await this.authorize(fromPath));
    const requested = normalizedLocalLink(target);
    const matched = extractLinks(source.content).find(
      (link) => !link.image && normalizedLocalLink(link.target).key === requested.key,
    );
    if (!matched) throw new Error('目标不是源笔记中的有效链接');
    if (!requested.file) return source;
    if (/^[a-z][a-z\d+.-]*:/i.test(requested.file) && !path.isAbsolute(requested.file))
      throw new Error('此操作只支持本地 Markdown 链接');
    const extension = path.extname(requested.file).toLowerCase();
    if (extension && !noteExtensions.has(extension))
      throw new Error('此操作只能打开 Markdown 链接');
    const direct = path.resolve(path.dirname(fromPath), requested.file);
    const candidates = extension ? [direct] : [`${direct}.md`, `${direct}.markdown`];
    for (const candidate of candidates) {
      try {
        const resolved = await canonical(candidate);
        if (!(await stat(resolved)).isFile()) continue;
        if (!noteExtensions.has(path.extname(resolved).toLowerCase()))
          throw new Error('链接实际目标不是 Markdown 文件');
        await this.approveFile(resolved);
        return this.readNote(resolved);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    const indexed = await this.resolveLink(fromPath, matched.target);
    if (!indexed.path || !indexed.exists) return null;
    if (!noteExtensions.has(path.extname(indexed.path).toLowerCase()))
      throw new Error('链接实际目标不是 Markdown 文件');
    return this.readNote(indexed.path);
  }
  async resolveAssetPath(target: string, fromPath?: string): Promise<string> {
    let file = target;
    if (file.startsWith('file:')) file = fileURLToPath(file);
    else {
      try {
        file = decodeURIComponent(file.split('#')[0]);
      } catch {
        file = file.split('#')[0];
      }
      if (!path.isAbsolute(file)) {
        if (!fromPath) throw new Error('相对资源路径缺少来源笔记');
        fromPath = await this.authorize(fromPath);
        file = path.resolve(path.dirname(fromPath), file);
      }
    }
    try {
      const allowed = await this.authorize(file);
      try {
        if ((await stat(allowed)).isFile()) return allowed;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      // Wiki image embeds commonly omit their attachment directory. Resolve an unambiguous short name.
      if (
        fromPath &&
        !path.isAbsolute(target) &&
        imageExtensions.has(path.extname(file).toLowerCase())
      ) {
        const matches: string[] = [];
        const collect = (entries: FileEntry[]): void => {
          for (const entry of entries)
            if (entry.children) collect(entry.children);
            else if (entry.kind === 'attachment' && entry.name === path.basename(file))
              matches.push(entry.path);
        };
        for (const root of this.settings.roots) collect(await this.getTree(root));
        if (matches.length === 1) return matches[0];
      }
      return allowed;
    } catch (error) {
      // A standalone note grants access only to image links actually present in that note.
      if (!fromPath || !imageExtensions.has(path.extname(file).toLowerCase())) throw error;
      const note = await this.readNote(await this.authorize(fromPath));
      const canonicalFile = await canonical(file);
      for (const link of extractLinks(note.content).filter(
        (link) =>
          link.image &&
          (!/^[a-z][a-z\d+.-]*:/i.test(link.target) ||
            path.isAbsolute(link.target) ||
            link.target.startsWith('file:')),
      )) {
        let reference = link.target;
        try {
          reference = reference.startsWith('file:')
            ? fileURLToPath(reference)
            : decodeURIComponent(reference);
        } catch {
          /* literal filenames may contain percent signs */
        }
        if (
          (await canonical(path.resolve(path.dirname(fromPath), reference.split('#')[0]))) ===
          canonicalFile
        ) {
          this.access.files.add(canonicalFile);
          return canonicalFile;
        }
      }
      throw error;
    }
  }
  async setTags(file: string, tags: string[]): Promise<NoteDocument> {
    const note = await this.readNote(file);
    const result = await this.saveFile({
      path: note.path,
      content: setFrontmatterTags(note.content, tags),
      baseContent: note.content,
      hash: note.hash,
      title: note.title,
    });
    if (!result.note) throw new Error('标签保存遇到外部冲突，请先处理冲突');
    return result.note;
  }
  async trashFile(file: string): Promise<void> {
    file = await this.authorize(file);
    if (!this.adapters.trash) throw new Error('系统回收站不可用，文件未删除');
    return this.queue.run(async () => {
      if (!(await stat(file)).isFile()) throw new Error('只能将单个文件移入回收站');
      await this.adapters.trash!(file);
      await this.history.markDeleted(file);
      this.changed([file]);
    });
  }
  putAttachment(
    notePath: string,
    name: string,
    bytes: number[],
  ): Promise<{ path: string; reference: string }> {
    return this.attachments.put(notePath, name, bytes);
  }
  localizeImages(
    notePath: string,
    content: string,
    urls?: string[],
  ): Promise<{ content: string; results: LocalizationResult[] }> {
    return this.attachments.localize(notePath, content, urls);
  }
  scanAttachments(): Promise<AttachmentCandidate[]> {
    return this.attachments.scan();
  }
  trashAttachments(files: string[]): Promise<void> {
    return this.attachments.trash(files);
  }
  moveFile(from: string, to?: string): Promise<MoveOutcome | null> {
    return this.moves.move(from, to);
  }
  undoMove(id: string): Promise<void> {
    return this.moves.undo(id);
  }
  async listHistory(file?: string): Promise<HistoryEntry[]> {
    if (file) file = await this.authorize(file);
    return this.history.list(file);
  }
  readHistory(id: string): Promise<{ content: string; entry: HistoryEntry }> {
    return this.history.read(id);
  }
  pinHistory(id: string, pinned: boolean): Promise<void> {
    return this.queue.run(() => this.history.pin(id, pinned));
  }
  async historyStats(): Promise<HistoryStats> {
    return this.history.stats();
  }
  pruneHistory(): Promise<HistoryStats> {
    return this.queue.run(() => this.history.prune());
  }
  async restoreHistory(id: string): Promise<NoteDocument> {
    return this.queue.run(async () => {
      const { entry, content } = await this.history.read(id);
      const file = await this.authorize(entry.path);
      const current = await readOptional(file);
      if (current) await this.history.snapshot(file, current.toString('utf8'), '恢复前');
      for (const image of await this.history.imageCopies(id))
        await atomicWrite(await this.approveFile(image.original), image.bytes);
      await atomicWrite(file, content);
      this.changed([file]);
      return this.readNote(file);
    });
  }
  async periodicNote(
    kind: 'daily' | 'weekly' | 'monthly',
    date: string,
    templateId?: string,
    createAdditional = false,
  ): Promise<NoteDocument | null> {
    const parsedDate = new Date(`${date}T12:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    )
      throw new Error('日期格式必须为有效的 YYYY-MM-DD');
    if (
      (kind === 'weekly' && !this.settings.weeklyEnabled) ||
      (kind === 'monthly' && !this.settings.monthlyEnabled)
    )
      throw new Error('请先在设置中启用对应周期笔记');
    let directory = this.settings.journalDirectory;
    if (!directory) {
      directory = (await this.selectDirectory()) ?? '';
      if (!directory) return null;
      await this.saveSettings({ ...this.getSettings(), journalDirectory: directory });
    }
    directory = await this.access.assertDirectory(directory);
    const actual = new Date(`${date}T12:00:00Z`);
    const thursday = new Date(actual);
    thursday.setUTCDate(actual.getUTCDate() + 4 - (actual.getUTCDay() || 7));
    const weekYear = thursday.getUTCFullYear();
    const week = Math.ceil(((thursday.getTime() - Date.UTC(weekYear, 0, 1)) / 86400_000 + 1) / 7);
    const variables: Record<string, string> = {
      date,
      year: String(kind === 'weekly' ? weekYear : actual.getUTCFullYear()),
      month: date.slice(5, 7),
      day: date.slice(8, 10),
      week: String(week).padStart(2, '0'),
      title:
        kind === 'daily'
          ? date
          : kind === 'weekly'
            ? `${weekYear}-W${String(week).padStart(2, '0')}`
            : date.slice(0, 7),
    };
    const render = (value: string): string =>
      value.replace(/\{\{(\w+)\}\}/g, (whole: string, key: string) => variables[key] ?? whole);
    const pattern =
      kind === 'daily'
        ? this.settings.dailyPattern
        : kind === 'weekly'
          ? this.settings.weeklyPattern
          : this.settings.monthlyPattern;
    const baseFile = path.resolve(directory, render(pattern));
    if (!within(directory, baseFile) || !noteExtensions.has(path.extname(baseFile).toLowerCase()))
      throw new Error('周期笔记路径必须在日记目录内，且以 .md 结尾');
    await this.authorize(baseFile);
    const template =
      this.settings.templates.find((item) => item.id === templateId) ??
      this.settings.templates.find((item) => item.kind === kind);
    const content = render(template?.content ?? '# {{title}}\n\n');
    const file = await this.queue.run(async () => {
      await mkdir(path.dirname(baseFile), { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      const extension = path.extname(baseFile);
      const stem = path.basename(baseFile, extension);
      let number = createAdditional ? 2 : 0;
      for (;;) {
        const candidate = number
          ? path.join(path.dirname(baseFile), `${stem}-${number}${extension}`)
          : baseFile;
        await this.authorize(candidate);
        // Exclusive creation handles both same-process reentry and files created by other programs.
        try {
          await writeFile(candidate, content, { flag: 'wx' });
          this.changed([candidate]);
          return candidate;
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
          if (!createAdditional) return baseFile;
          number++;
        }
      }
    });
    return this.readNote(file);
  }
}

/** Create the destination exclusively, then unlink the source; never overwrite a competing target. */
export async function moveExclusive(from: string, to: string): Promise<void> {
  if (await readOptional(to)) throw new Error('目标文件已经存在');
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await link(from, to);
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      ['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(String(error.code))
    ))
      throw error;
    const { constants } = await import('node:fs');
    await copyFile(from, to, constants.COPYFILE_EXCL);
  }
  try {
    await unlink(from);
  } catch (error) {
    await rm(to, { force: true });
    throw error;
  }
}
