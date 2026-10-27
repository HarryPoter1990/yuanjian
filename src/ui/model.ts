import type { Appearance, NoteDocument, SaveOutcome, TabState } from '../shared/types';
import { builtinPalettes } from '../shared/palettes';
import { diff3Merge } from 'node-diff3';
import { shortcutKey } from '../shared/shortcuts';
import { accentForeground } from '../shared/appearance';

export function appearanceColors(appearance: Appearance, systemDark: boolean) {
  const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && systemDark);
  const mode = dark ? 'dark' : 'light';
  const paired = appearance.paletteByMode?.[mode];
  const overrides = appearance.paletteOverrides?.[mode];
  const palette = builtinPalettes.find((item) => item.id === (paired ?? appearance.palette));
  if (palette) {
    const colors = palette[dark ? 'dark' : 'light'];
    const resolve = (key: 'bg' | 'fg' | 'accent', value: string) =>
      paired ||
      [palette.light[key], palette.dark[key]].some(
        (color) => color.toLowerCase() === value.toLowerCase(),
      )
        ? colors[key]
        : value;
    const accent = overrides?.accent ?? resolve('accent', appearance.accent);
    const surface = overrides?.surface ?? colors.surface;
    const refined = 'control' in colors;
    return {
      dark,
      refined,
      controlBorder: overrides?.border ?? ('control' in colors ? colors.control : undefined),
      pinAccent: 'gold' in colors ? colors.gold : undefined,
      quoteBackground: refined ? 'transparent' : surface,
      background: overrides?.background ?? resolve('bg', appearance.background),
      foreground: overrides?.foreground ?? resolve('fg', appearance.foreground),
      accent,
      sidebar: overrides?.sidebar ?? colors.sidebar,
      surface,
      muted: overrides?.muted ?? colors.muted,
      border: overrides?.border ?? colors.border,
      selected: overrides?.selected ?? colors.selected,
      accentText:
        refined && accent.toLowerCase() === colors.accent.toLowerCase()
          ? colors.accentText
          : accentForeground(accent),
    };
  }
  const background =
    overrides?.background ??
    (dark && appearance.background === '#f6f5f1' ? '#1c2227' : appearance.background);
  const foreground =
    overrides?.foreground ??
    (dark && appearance.foreground === '#292d32' ? '#e1e6e9' : appearance.foreground);
  const accent =
    overrides?.accent ?? (dark && appearance.accent === '#3b756b' ? '#87b9a5' : appearance.accent);
  const surface = overrides?.surface ?? `color-mix(in srgb, ${foreground} 4%, ${background})`;
  return {
    dark,
    refined: false,
    controlBorder: undefined,
    pinAccent: undefined,
    quoteBackground: surface,
    background,
    foreground,
    accent,
    sidebar: overrides?.sidebar ?? background,
    surface,
    muted: overrides?.muted ?? `color-mix(in srgb, ${foreground} 70%, ${background})`,
    border: overrides?.border ?? `color-mix(in srgb, ${foreground} 16%, ${background})`,
    selected: overrides?.selected ?? `color-mix(in srgb, ${foreground} 9%, ${background})`,
    accentText: accentForeground(accent),
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
export interface SaveAcceptance {
  tab: TabState;
  conflict?: NonNullable<SaveOutcome['conflict']>;
}
export function acceptSave(tab: TabState, submitted: string, outcome: SaveOutcome): SaveAcceptance {
  if (outcome.status !== 'saved' || !outcome.note) return { tab };
  const note = outcome.note;
  const normalize = (value: string) => value.replace(/\r\n?/g, '\n');
  let content = normalize(tab.content) === normalize(submitted) ? note.content : tab.content;
  if (content !== note.content && normalize(note.content) !== normalize(submitted)) {
    // Later keystrokes and the completed disk merge both descend from the submitted text.
    const result = diff3Merge(
      normalize(content).split('\n'),
      normalize(submitted).split('\n'),
      normalize(note.content).split('\n'),
    );
    if (result.some((region) => region.conflict)) {
      if (!note.path) throw new Error('已保存文档缺少文件位置，编辑内容已保留');
      return {
        tab: { ...tab, path: note.path, title: note.title, dirty: true },
        conflict: {
          path: note.path,
          base: submitted,
          ours: tab.content,
          theirs: note.content,
          hash: note.hash,
        },
      };
    }
    content = result.flatMap((region) => region.ok ?? []).join('\n');
  }
  const dirty = normalize(content) !== normalize(note.content);
  return {
    tab: {
      ...tab,
      path: note.path,
      title: note.title,
      hash: note.hash,
      modifiedAt: note.modifiedAt,
      baseContent: note.content,
      content: dirty ? content : note.content,
      dirty,
    },
  };
}
export function matchesShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  shortcut: string,
): boolean {
  const keys = shortcutKey(shortcut)
    .toLowerCase()
    .split('+')
    .map((s) => s.trim());
  const key = keys.at(-1);
  return Boolean(
    key &&
    (event.key === '+' ? 'plus' : event.key === ' ' ? 'space' : event.key.toLowerCase()) === key &&
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
