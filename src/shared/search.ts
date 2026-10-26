import type { SearchNote, SearchPage } from './types';
import { parseNote } from './markdown';
export const searchTerms = (query: string): string[] => [
  ...new Set(
    [...query.matchAll(/"([^"]+)"|([^\s"]+)/g)].map((match) =>
      (match[1] ?? match[2]).toLocaleLowerCase(),
    ),
  ),
];
export function searchDocument(
  query: string,
  note: {
    path: string | null;
    title: string;
    content: string;
    tags: string[];
    id?: string;
    dirty?: boolean;
  },
): SearchNote | null {
  const terms = searchTerms(query);
  const title = note.title.toLocaleLowerCase(),
    file = (note.path?.split(/[\\/]/).at(-1) ?? '').toLocaleLowerCase();
  const body = note.content.toLocaleLowerCase();
  if (!terms.length || !terms.every((term) => `${title}\n${file}\n${body}`.includes(term)))
    return null;
  const matches: SearchNote['matches'] = [];
  let matchCount = 0;
  for (const [number, line] of note.content.split(/\r?\n/).entries()) {
    const lower = line.toLocaleLowerCase();
    const positions = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0);
    if (!positions.length) continue;
    matchCount++;
    if (matches.length < 100) {
      const start = Math.max(0, Math.min(...positions) - 45);
      matches.push({
        line: number + 1,
        snippet: `${start ? '…' : ''}${line.slice(start, start + 220)}${start + 220 < line.length ? '…' : ''}`,
      });
    }
  }
  if (!matches.length)
    matches.push({ line: 1, snippet: note.content.split(/\r?\n/, 1)[0].slice(0, 220) });
  const score =
    terms.filter((term) => title.includes(term)).length * 1000 +
    terms.filter((term) => file.includes(term)).length * 100 +
    Math.min(matchCount, 20);
  return {
    id: note.id ?? note.path!,
    path: note.path,
    title: note.title,
    dirty: note.dirty,
    tags: note.tags,
    matches,
    matchCount,
    score,
  };
}
export function sortSearchNotes(notes: SearchNote[]): SearchNote[] {
  return notes.sort(
    (a, b) =>
      b.score - a.score ||
      (a.path ?? a.title).localeCompare(b.path ?? b.title, 'zh-CN', { numeric: true }),
  );
}
export function mergeOpenSearch(
  page: SearchPage,
  query: string,
  tabs: { id: string; path: string | null; title: string; content: string; dirty: boolean }[],
  scope: string,
): SearchPage {
  const normalize = (value: string) =>
    value.replace(/\\/g, '/').toLocaleLowerCase().replace(/\/$/, '');
  const eligible = tabs.filter(
    (tab) => !scope || (tab.path && normalize(tab.path).startsWith(`${normalize(scope)}/`)),
  );
  const paths = new Set(eligible.flatMap((tab) => (tab.path ? [normalize(tab.path)] : [])));
  const notes = page.notes.filter((note) => !note.path || !paths.has(normalize(note.path)));
  for (const tab of eligible) {
    const meta = parseNote(tab.content, tab.path ?? tab.title);
    const result = searchDocument(query, { ...tab, title: meta.title, tags: meta.tags });
    if (result) notes.push(result);
  }
  return { ...page, notes: sortSearchNotes(notes) };
}
