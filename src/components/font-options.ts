import type { FontEntry } from '../shared/types';

export const fontSources: Record<FontEntry['source'], string> = {
  bundled: '内置',
  downloaded: '已下载',
  imported: '已导入',
  system: '系统',
};
export const fontGroups = [
  { id: 'bundled', label: '内置字体' },
  { id: 'managed', label: '已下载 / 已导入' },
  { id: 'system', label: '系统字体' },
] as const;
export const fontGroup = (font: FontEntry) =>
  font.source === 'imported' || font.source === 'downloaded' ? 'managed' : font.source;

export interface FontChoice {
  name: string;
  group: ReturnType<typeof fontGroup>;
  sources: FontEntry['source'][];
}
// Choice values remain the original family strings; management keeps every file entry.
export function fontChoices(fonts: FontEntry[]): FontChoice[] {
  const choices = new Map<string, FontChoice>();
  for (const font of fonts) {
    const existing = choices.get(font.name);
    if (existing) {
      if (!existing.sources.includes(font.source)) existing.sources.push(font.source);
    } else
      choices.set(font.name, { name: font.name, group: fontGroup(font), sources: [font.source] });
  }
  return [...choices.values()];
}
