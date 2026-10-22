import { isMap, parseDocument } from 'yaml';

/** Metadata stays in the source document; only valid leading properties are omitted from reading output. */
export function withoutFrontmatter(source: string): string {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return source;
  try {
    const document = parseDocument(match[1]);
    if (document.errors.length || (document.contents !== null && !isMap(document.contents)))
      return source;
    document.toJS({ maxAliasCount: 20 });
    return source.slice(match[0].length);
  } catch {
    return source;
  }
}
