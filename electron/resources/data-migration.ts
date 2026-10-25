import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface DataMigrationResult {
  directory: string;
  migrated: boolean;
  warnings: string[];
}
// The previous folder name is retained only to locate and preserve existing user data.
export const LEGACY_DATA_NAME = '轻笺';
export const DATA_NAME = '鸢笺';
const caches = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Crashpad',
  'Network',
  'Session Storage',
  'blob_storage',
  'logs',
]);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function exists(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function inside(root: string, file: string): string | null {
  const relative = path.relative(root, path.resolve(file));
  return relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
    ? relative
    : null;
}
async function inspect(root: string, copyTo?: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  async function visit(directory: string, relative = '') {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!relative && (caches.has(item.name) || /^Singleton/.test(item.name))) continue;
      const key = path.join(relative, item.name),
        source = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error(`数据目录含链接，未自动迁移：${key}`);
      if (item.isDirectory()) {
        entries.set(key, 'directory');
        if (copyTo) await mkdir(path.join(copyTo, key));
        await visit(source, key);
      } else if (item.isFile()) {
        const bytes = await readFile(source);
        entries.set(key, digest(bytes));
        if (copyTo) await writeFile(path.join(copyTo, key), bytes, { flag: 'wx' });
      } else throw new Error(`数据目录含特殊文件，未自动迁移：${key}`);
    }
  }
  await visit(root);
  return entries;
}
function equal(left: Map<string, string>, right: Map<string, string>) {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
}

async function rebaseManagedPaths(
  stage: string,
  oldRoot: string,
  newRoot: string,
  copied: Map<string, string>,
) {
  const manifest = path.join(stage, 'fonts', 'manifest.json');
  if (await exists(manifest)) {
    const fonts: unknown = JSON.parse(await readFile(manifest, 'utf8'));
    if (!Array.isArray(fonts)) throw new Error('旧字体清单格式错误，未切换数据目录');
    for (const entry of fonts) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.path !== 'string' ||
        path.dirname(path.resolve(entry.path)) !== path.join(oldRoot, 'fonts')
      )
        throw new Error('旧字体清单位置无法核对，未切换数据目录');
      const relative = inside(oldRoot, entry.path);
      if (!relative || !copied.has(relative)) throw new Error('旧字体文件缺失，未切换数据目录');
      entry.path = path.join(newRoot, relative);
    }
    await writeFile(manifest, JSON.stringify(fonts, null, 2));
  }
  const settingsFile = path.join(stage, 'settings.json');
  if (!(await exists(settingsFile))) return;
  const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  let changed = false;
  for (const appearance of [
    settings.appearance,
    ...(Array.isArray(settings.themes)
      ? settings.themes.map((theme: { appearance?: unknown }) => theme?.appearance)
      : []),
  ]) {
    if (!appearance || typeof appearance !== 'object' || typeof appearance.wallpaper !== 'string')
      continue;
    const relative = path.isAbsolute(appearance.wallpaper)
      ? inside(oldRoot, appearance.wallpaper)
      : null;
    if (relative && copied.has(relative) && copied.get(relative) !== 'directory') {
      appearance.wallpaper = path.join(newRoot, relative);
      changed = true;
    }
  }
  if (changed) await writeFile(settingsFile, JSON.stringify(settings, null, 2));
}

/** Publish a verified copy; never delete or mutate the legacy directory or overwrite an existing target. */
export async function migrateDataDirectory(appDataRoot: string): Promise<DataMigrationResult> {
  const root = path.resolve(appDataRoot),
    directory = path.join(root, DATA_NAME),
    legacy = path.join(root, LEGACY_DATA_NAME);
  const existing = await exists(directory);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new Error('鸢笺数据目录不是普通目录');
    return { directory, migrated: false, warnings: [] };
  }
  const original = await exists(legacy);
  if (!original) {
    await mkdir(directory, { recursive: true });
    return { directory, migrated: false, warnings: [] };
  }
  const stage = path.join(root, `.yuanjian-migration-${randomUUID()}`);
  try {
    if (!original.isDirectory() || original.isSymbolicLink())
      throw new Error('旧数据目录不是普通目录');
    await mkdir(stage);
    const copied = await inspect(legacy, stage);
    if (!equal(copied, await inspect(stage)) || !equal(copied, await inspect(legacy)))
      throw new Error('复制校验未通过或旧数据仍在变化，请退出旧版后重试');
    await rebaseManagedPaths(stage, legacy, directory, copied);
    const staged = await inspect(stage);
    for (const [key, value] of copied) {
      if (key === path.join('fonts', 'manifest.json') || key === 'settings.json') continue;
      if (staged.get(key) !== value) throw new Error('迁移副本核验失败');
    }
    if (!equal(copied, await inspect(legacy)))
      throw new Error('旧数据在迁移期间发生变化，请退出旧版后重试');
    if (await exists(directory)) {
      await rm(stage, { recursive: true, force: true });
      return {
        directory,
        migrated: false,
        warnings: ['鸢笺数据目录已存在，未覆盖，旧数据保持原样。'],
      };
    }
    await rename(stage, directory);
    return {
      directory,
      migrated: true,
      warnings: ['旧数据已校验并复制到鸢笺数据目录，原目录保留为备份。'],
    };
  } catch (error) {
    // The UUID stage is created by this call directly under the supplied data root.
    if (path.dirname(stage) === root && path.basename(stage).startsWith('.yuanjian-migration-'))
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    return {
      directory: legacy,
      migrated: false,
      warnings: [
        `数据迁移未完成，继续使用原目录以保留内容：${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
