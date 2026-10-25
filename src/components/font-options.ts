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
