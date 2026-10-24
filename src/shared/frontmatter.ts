import { isMap, parseDocument, type Document } from 'yaml';

function startsWithProperty(source: string): boolean {
  const first = source.split(/\r?\n/).find((line) => line.trim()) ?? '';
  return /^[ \t]*(?:[\p{L}\p{N}_][^:\r\n]*|"[^"\r\n]*"|'[^'\r\n]*'):(?:[ \t]|$)/u.test(first);
}

export interface FrontmatterInspection {
  end: number;
  error: string | null;
  document?: Document;
}

export function inspectFrontmatter(source: string): FrontmatterInspection | null {
  const match = /^\uFEFF?---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/.exec(source);
  if (!match) {
    const opening = /^\uFEFF?---\r?\n/.exec(source);
    const mapping = opening && startsWithProperty(source.slice(opening[0].length));
    return opening && mapping
      ? { end: source.length, error: 'YAML 属性缺少结束分隔线，原文已保留' }
      : null;
  }
  const raw = match[1] ?? '';
  let properties = startsWithProperty(raw);
  try {
    const document = parseDocument(raw);
    properties ||= isMap(document.contents);
    if (!properties && raw.trim()) return null;
    if (document.errors.length || (document.contents !== null && !isMap(document.contents)))
      return { end: match[0].length, error: 'YAML 属性存在语法错误或不是键值结构，原文已保留' };
    document.toJS({ maxAliasCount: 20 });
    return { end: match[0].length, error: null, document };
  } catch {
    return properties ? { end: match[0].length, error: 'YAML 属性无法解析，原文已保留' } : null;
  }
}

/** Metadata stays in source; only valid leading properties are omitted from reading output. */
export function withoutFrontmatter(source: string): string {
  const properties = inspectFrontmatter(source);
  return properties && !properties.error ? source.slice(properties.end) : source;
}
