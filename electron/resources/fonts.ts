import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { FontCatalogEntry, FontEntry, OperationProgress } from '../../src/shared/types';
import { atomicWrite, readJson, writeJson } from '../storage/io';

const exec = promisify(execFile);
const MAX_FONT_BYTES = 256 * 1024 * 1024;
const extensions = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2']);
export function fontExtension(name: string): string | null {
  const extension = path.extname(name).toLowerCase();
  return extensions.has(extension) ? extension : null;
}
export function isFontData(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  const magic = Buffer.from(data.subarray(0, 4)).toString('latin1');
  return ['OTTO', 'ttcf', 'wOFF', 'wOF2', 'true', '\x00\x01\x00\x00'].includes(magic);
}
export function safeArchiveFont(name: string, size: number): boolean {
  return (
    !!fontExtension(name) &&
    !path.posix.isAbsolute(name) &&
    !path.win32.isAbsolute(name) &&
    !name.split(/[\\/]/).includes('..') &&
    size > 0 &&
    size <= MAX_FONT_BYTES
  );
}

// Font filenames and licenses are taken from the maintainers' repositories.
// https://github.com/google/fonts/tree/main/ofl/firacode
export const fontCatalog: FontCatalogEntry[] = [
  {
    id: 'fira-code',
    name: 'Fira Code',
    description: '开源等宽代码字体，支持连字；下载后可离线预览和使用。',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/firacode/FiraCode%5Bwght%5D.ttf',
    fileName: 'FiraCode.ttf',
    licenseUrl: 'https://github.com/google/fonts/blob/main/ofl/firacode/OFL.txt',
  },
  {
    id: 'source-code-pro',
    name: 'Source Code Pro',
    description: 'Adobe 开源等宽字体，适合代码记录。',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourcecodepro/SourceCodePro%5Bwght%5D.ttf',
    fileName: 'SourceCodePro.ttf',
    licenseUrl: 'https://github.com/google/fonts/blob/main/ofl/sourcecodepro/OFL.txt',
  },
  {
    id: 'lxgw-wenkai',
    name: '霞鹜文楷',
    description: '中文开源字体，适合日记与阅读；完整中文字库体积较大。',
    url: 'https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/fonts/TTF/LXGWWenKai-Regular.ttf',
    fileName: 'LXGWWenKai-Regular.ttf',
    licenseUrl: 'https://github.com/lxgw/LxgwWenKai/blob/main/OFL.txt',
  },
];
export const bundledFonts: FontEntry[] = [
  { id: 'noto-sans-sc', name: 'Noto Sans SC Variable', source: 'bundled' },
  { id: 'noto-serif-sc', name: 'Noto Serif SC Variable', source: 'bundled' },
  { id: 'inter', name: 'Inter Variable', source: 'bundled' },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', source: 'bundled' },
];

interface FontAdapters {
  selectFiles(): Promise<string[]>;
  assetUrl(file: string): Promise<string>;
  progress(progress: OperationProgress): void;
  fetch?: typeof fetch;
}
export class FontManager {
  private system: FontEntry[] | null = null;
  private readonly directory: string;
  private readonly manifest: string;
  constructor(
    dataDirectory: string,
    private readonly adapters: FontAdapters,
  ) {
    this.directory = path.join(dataDirectory, 'fonts');
    this.manifest = path.join(this.directory, 'manifest.json');
  }
  async getFonts(refresh = false): Promise<FontEntry[]> {
    if (!this.system || refresh) {
      // Constant command: user filenames and font names never enter shell code.
      const result = await exec(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; $fontCollection=[System.Drawing.Text.InstalledFontCollection]::new(); @($fontCollection.Families | ForEach-Object {$_.Name}) | ConvertTo-Json -Compress',
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
      );
      const names: unknown = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
      if (!Array.isArray(names) || !names.every((name) => typeof name === 'string'))
        throw new Error('系统字体列表格式无法识别');
      this.system = [...new Set(names)]
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        .map((name) => ({ id: `system:${name}`, name, source: 'system' }));
    }
    return [...bundledFonts, ...(await this.managedFonts()), ...this.system];
  }
  async managedFonts(): Promise<FontEntry[]> {
    const entries = await readJson<FontEntry[]>(this.manifest, []);
    const result: FontEntry[] = [];
    for (const entry of entries) {
      if (!entry.path || path.dirname(path.resolve(entry.path)) !== path.resolve(this.directory))
        throw new Error('字体索引含有非法位置');
      await stat(entry.path);
      result.push({ ...entry, url: await this.adapters.assetUrl(entry.path) });
    }
    return result;
  }
  private async saveImported(
    name: string,
    bytes: Uint8Array,
    source: 'imported' | 'downloaded',
    family?: string,
  ): Promise<FontEntry> {
    const extension = fontExtension(name);
    if (!extension || bytes.length > MAX_FONT_BYTES || !isFontData(bytes))
      throw new Error(`不是受支持的字体文件：${path.basename(name)}`);
    await mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    const file = path.join(this.directory, `${id}${extension}`);
    await atomicWrite(file, bytes);
    const entries = await readJson<FontEntry[]>(this.manifest, []);
    const entry: FontEntry = {
      id,
      name: family ?? path.basename(name, path.extname(name)),
      source,
      path: file,
      bytes: bytes.length,
    };
    try {
      await writeJson(this.manifest, [...entries, entry]);
    } catch (error) {
      await unlink(file);
      throw error;
    }
    return { ...entry, url: await this.adapters.assetUrl(file) };
  }
  async importFonts(): Promise<FontEntry[]> {
    const files = await this.adapters.selectFiles();
    const imported: FontEntry[] = [];
    for (const file of files) {
      const info = await stat(file);
      if (info.size > MAX_FONT_BYTES) throw new Error('字体包超过 256 MiB，请拆分后导入');
      const bytes = await readFile(file);
      if (path.extname(file).toLowerCase() === '.zip') {
        let total = 0;
        let count = 0;
        const fonts = unzipSync(bytes, {
          filter: (entry) => {
            if (!safeArchiveFont(entry.name, entry.originalSize)) return false;
            total += entry.originalSize;
            count++;
            if (total > MAX_FONT_BYTES || count > 256)
              throw new Error('字体包解压后过大或字体数量超过 256');
            return true;
          },
        });
        for (const [name, data] of Object.entries(fonts))
          imported.push(await this.saveImported(name, data, 'imported'));
        if (!Object.keys(fonts).length) throw new Error('ZIP 中未找到受支持的字体文件');
      } else imported.push(await this.saveImported(file, bytes, 'imported'));
    }
    return imported;
  }
  async downloadFont(id: string): Promise<FontEntry[]> {
    const item = fontCatalog.find((entry) => entry.id === id);
    if (!item) throw new Error('字体不在下载目录中');
    const operation = randomUUID();
    this.adapters.progress({
      id: operation,
      kind: 'font',
      completed: 0,
      message: `正在下载 ${item.name}`,
    });
    const response = await (this.adapters.fetch ?? fetch)(item.url, {
      signal: AbortSignal.timeout(60000),
      redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error(`字体下载失败：HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || undefined;
    if (total && total > MAX_FONT_BYTES) throw new Error('字体下载超过大小限制');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        loaded += part.value.length;
        if (loaded > MAX_FONT_BYTES) throw new Error('字体下载超过大小限制');
        chunks.push(part.value);
        this.adapters.progress({
          id: operation,
          kind: 'font',
          completed: loaded,
          total,
          message: `正在下载 ${item.name}`,
        });
      }
    } finally {
      await reader.cancel();
    }
    const entry = await this.saveImported(
      item.fileName,
      Buffer.concat(chunks),
      'downloaded',
      item.name,
    );
    this.adapters.progress({
      id: operation,
      kind: 'font',
      completed: loaded,
      total: loaded,
      message: `${item.name} 已下载，可离线使用`,
    });
    return [entry];
  }
  async removeFont(id: string): Promise<void> {
    const entries = await readJson<FontEntry[]>(this.manifest, []);
    const entry = entries.find((font) => font.id === id);
    if (!entry?.path || path.dirname(path.resolve(entry.path)) !== path.resolve(this.directory))
      throw new Error('只能移除软件内部导入或下载的字体');
    await writeJson(
      this.manifest,
      entries.filter((font) => font.id !== id),
    );
    await unlink(entry.path);
  }
}
