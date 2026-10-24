import type { Settings } from '../shared/types';
import { settingsGroups, settingsItems } from './settingsFields';
export { settingsGroups } from './settingsFields';

const wallpaperControls = new Set([
  'wallpaperOpacity',
  'wallpaperBlur',
  'wallpaperBrightness',
  'wallpaperFit',
  'wallpaperPosition',
]);
const templateControls = new Set(['templateName', 'templateKind', 'templateContent']);
export function searchSettings(query: string, settings?: Settings) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return settingsItems(settings)
    .map((entry) => {
      let target = entry.id;
      let description = entry.description;
      if (settings && wallpaperControls.has(entry.id) && !settings.appearance.wallpaper) {
        target = 'wallpaper';
        description += ' 请先选择壁纸。';
      }
      if (settings && templateControls.has(entry.id) && !settings.templates.length) {
        target = 'templates';
        description += ' 请先新增模板。';
      }
      return {
        ...entry,
        target,
        description,
        group: settingsGroups.find((group) => group.id === entry.section)!.label,
      };
    })
    .filter((entry) =>
      terms.every((term) =>
        `${entry.group} ${entry.label} ${entry.description}`.toLocaleLowerCase().includes(term),
      ),
    );
}
