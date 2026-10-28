import { extractLinks, noteFragment } from '../shared/markdown';
import type { NoteResolution } from '../shared/note-syntax';

export interface ReferenceRoot {
  id: string;
  path: string | null;
  content: string;
}
export const referencePath = (note: ReferenceRoot) => note.path ?? `draft:${note.id}`;
export const notePathKey = (value: string) => {
  const key = value.replace(/\\/g, '/');
  return /^(?:[a-z]:|\/\/)/i.test(key) ? key.toLocaleLowerCase() : key;
};
const referenceKey = (from: string, reference: string) =>
  `${notePathKey(from)}\0${reference.trim().replace(/\\/g, '/')}`;
export interface NoteReferences {
  sources: Map<string, string>;
  resolveNote(reference: string, from?: string): NoteResolution;
}
export type NoteReader = (from: string, target: string) => Promise<NoteResolution>;

/** Read only reachable embeds; errors stay local, and no read operation grants access. */
export async function loadNoteReferences(
  root: ReferenceRoot,
  openSource: (path: string) => string | undefined,
  read: NoteReader,
): Promise<NoteReferences> {
  const rootPath = referencePath(root),
    sources = new Map<string, string>([[rootPath, root.content]]);
  const results = new Map<string, NoteResolution>();
  const visited = new Set<string>();
  const queue = [{ path: rootPath, fragment: '', depth: 0 }];
  let bytes = 0,
    requests = 0,
    limited = false;
  const ownSource = (path: string) =>
    openSource(path) ??
    (notePathKey(path) === notePathKey(rootPath) ? root.content : sources.get(path));
  for (let index = 0; index < queue.length; index++) {
    if (index >= 512) {
      limited = true;
      break;
    }
    const item = queue[index],
      identity = `${notePathKey(item.path)}#${item.fragment}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    const source = ownSource(item.path);
    if (source === undefined) continue;
    const selected = noteFragment(source, item.fragment);
    if ('error' in selected) continue;
    for (const link of extractLinks(selected.source).filter(
      (link) => link.embedded && !link.image,
    )) {
      const [reference, rawFragment = ''] = link.target.split('#', 2);
      let fragment: string;
      try {
        fragment = decodeURIComponent(rawFragment);
      } catch {
        continue;
      }
      const key = referenceKey(item.path, reference);
      let result = results.get(key);
      if (!result) {
        if (!reference || notePathKey(reference) === notePathKey(item.path))
          result = { path: item.path, source };
        else if (item.path.startsWith('draft:'))
          result = { error: '请先保存笔记，再解析跨文件嵌入' };
        else if (requests >= 128) {
          limited = true;
          result = { error: '嵌入引用过多，请分成较小的笔记' };
        } else {
          requests++;
          try {
            result = await read(item.path, reference);
          } catch (error) {
            result = {
              error: `引用笔记读取失败：${error instanceof Error ? error.message : String(error)}`,
            };
          }
          if ('path' in result) {
            const current = openSource(result.path) ?? result.source;
            if (!sources.has(result.path) && bytes + current.length > 2 * 1024 * 1024)
              result = { error: '嵌入内容超过 2 MiB，请打开原笔记查看' };
            else {
              if (!sources.has(result.path)) bytes += current.length;
              result = { ...result, source: current };
            }
          }
        }
        results.set(key, result);
      }
      if ('path' in result) {
        sources.set(result.path, result.source);
        if (item.depth < 12) queue.push({ path: result.path, fragment, depth: item.depth + 1 });
      }
    }
  }
  return {
    sources,
    resolveNote(reference, from = rootPath) {
      if (!reference || notePathKey(reference) === notePathKey(from)) {
        const source = ownSource(from);
        if (source !== undefined) return { path: from, source };
      }
      const result = results.get(referenceKey(from, reference));
      if (!result)
        return {
          error: limited
            ? '嵌入引用过多，请打开原笔记查看'
            : `正在解析或无法确认引用：${reference}`,
        };
      return 'path' in result
        ? { ...result, source: openSource(result.path) ?? result.source }
        : result;
    },
  };
}
