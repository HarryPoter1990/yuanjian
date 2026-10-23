import { isMap, parseDocument } from 'yaml';

function startsWithProperty(source: string): boolean {
  const first = source.split(/\r?\n/).find((line) => line.trim()) ?? '';
  return /^[ \t]*(?:[\p{L}\p{N}_][^:\r\n]*|"[^"\r\n]*"|'[^'\r\n]*'):(?:[ \t]|$)/u.test(first);
}

export function inspectFrontmatter(source: string): { end: number; error: string | null } | null {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) {
    const opening = /^\uFEFF?---\r?\n/.exec(source);
    // Without a closing delimiter, only an explicit mapping start indicates metadata intent.
    const mapping = opening && startsWithProperty(source.slice(opening[0].length));
    return opening && mapping
      ? { end: source.length, error: 'YAML 属性缺少结束分隔线，原文已保留' }
      : null;
  }
  let properties = startsWithProperty(match[1]);
  try {
    const document = parseDocument(match[1]);
    properties ||= isMap(document.contents);
    if (!properties && match[1].trim()) return null;
    if (document.errors.length || (document.contents !== null && !isMap(document.contents)))
      return { end: match[0].length, error: 'YAML 属性存在语法错误或不是键值结构，原文已保留' };
    document.toJS({ maxAliasCount: 20 });
    return { end: match[0].length, error: null };
  } catch {
    return properties ? { end: match[0].length, error: 'YAML 属性无法解析，原文已保留' } : null;
  }
}

/** Metadata stays in the source document; only valid leading properties are omitted from reading output. */
export function withoutFrontmatter(source: string): string {
  const properties = inspectFrontmatter(source);
  return properties && !properties.error ? source.slice(properties.end) : source;
}
