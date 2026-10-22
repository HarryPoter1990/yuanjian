import type { Appearance, NoteDocument, SaveOutcome, TabState } from '../shared/types';

export function appearanceColors(appearance: Appearance, systemDark: boolean) {
  const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && systemDark);
  return {
    dark,
    background: dark && appearance.background === '#f6f5f1' ? '#1c2227' : appearance.background,
    foreground: dark && appearance.foreground === '#292d32' ? '#e1e6e9' : appearance.foreground,
    accent: dark && appearance.accent === '#3b756b' ? '#87b9a5' : appearance.accent,
  };
}

export function makeDraft(content = '', title = '未命名笔记'): TabState {
  return {
    id: crypto.randomUUID(),
    path: null,
    title,
    content,
    baseContent: '',
    hash: '',
    modifiedAt: Date.now(),
    dirty: Boolean(content),
    cursor: 0,
    scrollTop: 0,
    mode: 'live',
  };
}
export function asTab(note: NoteDocument): TabState {
  return {
    ...note,
    baseContent: note.content,
    dirty: false,
    cursor: 0,
    scrollTop: 0,
    mode: 'live',
  };
}
export function acceptSave(tab: TabState, submitted: string, outcome: SaveOutcome): TabState {
  if (outcome.status !== 'saved' || !outcome.note) return tab;
  const note = outcome.note;
  const content = tab.content === submitted ? note.content : tab.content;
  return {
    ...tab,
    path: note.path,
    title: note.title,
    hash: note.hash,
    modifiedAt: note.modifiedAt,
    baseContent: note.content,
    content,
    dirty: content !== note.content,
  };
}
export function matchesShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  shortcut: string,
): boolean {
  const keys = shortcut
    .toLowerCase()
    .split('+')
    .map((s) => s.trim());
  const key = keys.at(-1);
  return Boolean(
    key &&
    event.key.toLowerCase() === key &&
    (event.ctrlKey || event.metaKey) === keys.includes('ctrl') &&
    event.altKey === keys.includes('alt') &&
    event.shiftKey === keys.includes('shift'),
  );
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export const fileName = (path: string) => path.split(/[\\/]/).at(-1) || path;
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function relativeNoteTarget(fromPath: string, targetPath: string): string {
  const normalize = (value: string) => value.replace(/\\/g, '/');
  const root = (value: string) =>
    value.startsWith('//')
      ? value.split('/').slice(0, 4).join('/').toLowerCase()
      : /^[a-z]:\//i.exec(value)?.[0].toLowerCase() || '/';
  const from = normalize(fromPath);
  const target = normalize(targetPath);
  if (root(from) !== root(target)) return target;
  const directory = from.split('/');
  directory.pop();
  const destination = target.split('/');
  let shared = 0;
  while (
    shared < directory.length &&
    shared < destination.length &&
    directory[shared].toLowerCase() === destination[shared].toLowerCase()
  )
    shared++;
  return (
    [...Array(directory.length - shared).fill('..'), ...destination.slice(shared)].join('/') ||
    fileName(target)
  );
}

export function markdownLink(label: string, target: string): string {
  const text = label.trim() ? label : '链接';
  // Encoding a Windows drive keeps it readable by our resolver without introducing a custom URI scheme.
  const raw = target.trim();
  const fileTarget =
    /^[a-z]:[\\/]/i.test(raw) || !/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw.replace(/\\/g, '/') : raw;
  const destination = fileTarget
    .replace(/^([a-z]):\//i, '$1%3A/')
    .replace(/[<>]/g, (value) => encodeURIComponent(value));
  return `[${text.replace(/[\\[\]]/g, '\\$&')}](${/[\s()]/.test(destination) ? `<${destination}>` : destination})`;
}
