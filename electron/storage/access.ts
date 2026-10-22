import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isMissing } from './io';

export function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/** Resolve every existing ancestor, including junctions; preserve only the nonexistent suffix. */
export async function canonical(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate) || candidate.includes('\0'))
    throw new Error('路径必须为绝对路径');
  let current = path.resolve(candidate);
  const suffix: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...suffix);
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export class PathAccess {
  readonly directories = new Set<string>();
  readonly files = new Set<string>();
  excluded: string[] = [];

  async approveFile(candidate: string): Promise<string> {
    const resolved = await canonical(candidate);
    this.files.add(resolved);
    return resolved;
  }
  async approveDirectory(candidate: string): Promise<string> {
    const resolved = await canonical(candidate);
    if (!(await stat(resolved)).isDirectory()) throw new Error('选择的路径不是目录');
    this.directories.add(resolved);
    return resolved;
  }
  isExcluded(root: string, candidate: string): boolean {
    const segments = path.relative(root, candidate).split(path.sep);
    return this.excluded.some((pattern) => {
      if (!pattern) return false;
      const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
      if (!normalized.includes('/') && !normalized.includes('*'))
        return segments.includes(normalized);
      const escaped = normalized
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0001')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0001/g, '.*');
      return new RegExp(`(^|/)${escaped}($|/)`).test(segments.join('/'));
    });
  }
  async assert(candidate: string): Promise<string> {
    const resolved = await canonical(candidate);
    if (this.files.has(resolved)) return resolved;
    for (const root of this.directories)
      if (within(root, resolved) && !this.isExcluded(root, resolved)) return resolved;
    throw new Error('路径未经授权，请通过打开文件或添加目录选择此位置');
  }
  async assertDirectory(candidate: string): Promise<string> {
    const resolved = await canonical(candidate);
    for (const root of this.directories)
      if (within(root, resolved) && !this.isExcluded(root, resolved)) return resolved;
    throw new Error('目录未经授权，请通过添加目录选择');
  }
}
