import { useEffect, useState } from 'react';
import type { Appearance, Settings } from '../shared/types';
import {
  allAppearanceParts,
  applyAppearanceScheme,
  applyColorTheme,
  colorThemeSnapshot,
} from '../shared/appearance';

export function AppearanceSchemes({
  settings,
  appearance,
  onChange,
  onPreview,
  onPending,
  onDelete,
}: {
  settings: Settings;
  appearance: Appearance;
  onChange(value: Partial<Settings>): void;
  onPreview(value: Appearance): void;
  onPending(value: boolean): void;
  onDelete(kind: 'color' | 'scheme', id: string): void;
}) {
  const [name, setName] = useState('我的外观');
  const [savedName, setSavedName] = useState('我的外观');
  useEffect(() => onPending(name !== savedName), [name, savedName, onPending]);
  useEffect(() => () => onPending(false), [onPending]);
  const [kind, setKind] = useState<'color' | 'scheme'>('color');
  const [selected, setSelected] = useState(appearance.colorThemeId ?? '');
  const [includes, setIncludes] = useState({ ...allAppearanceParts });
  const entries = kind === 'color' ? (settings.colorThemes ?? []) : settings.themes;
  const selection = entries.find((item) => item.id === selected);
  function save(update: boolean) {
    const id = update && selection ? selection.id : crypto.randomUUID();
    if (kind === 'color')
      onChange({
        colorThemes: [
          ...(settings.colorThemes ?? []).filter((item) => item.id !== id),
          { id, name: name.trim(), appearance: colorThemeSnapshot(appearance) },
        ],
      });
    else
      onChange({
        themes: [
          ...settings.themes.filter((item) => item.id !== id),
          {
            id,
            name: name.trim(),
            appearance: structuredClone(appearance),
            includes: { ...includes },
          },
        ],
      });
    setSelected(id);
    setSavedName(name);
  }
  return (
    <section className="appearance-schemes">
      <h4 data-setting-id="themes" data-setting-label="外观方案管理" tabIndex={-1}>
        外观方案管理
      </h4>
      <p className="section-description">
        保存方案与应用外观分开。方案列表按普通设置保存；预览仍需“应用外观”。内置配色始终保留原件。
      </p>
      <div className="segmented" role="group" aria-label="方案类型">
        <button
          aria-pressed={kind === 'color'}
          onClick={() => {
            setKind('color');
            setSelected('');
          }}
        >
          颜色主题
        </button>
        <button
          aria-pressed={kind === 'scheme'}
          onClick={() => {
            setKind('scheme');
            setSelected('');
          }}
        >
          完整外观方案
        </button>
      </div>
      <div className="scheme-list">
        {entries.map((entry) => (
          <div key={entry.id} className={entry.id === selected ? 'selected' : ''}>
            <button
              aria-label={`预览 ${entry.name}`}
              onClick={() => {
                setSelected(entry.id);
                setName(entry.name);
                setSavedName(entry.name);
                if (kind === 'color') {
                  const theme = settings.colorThemes!.find((t) => t.id === entry.id)!;
                  onPreview(applyColorTheme(appearance, theme));
                } else {
                  const scheme = settings.themes.find((t) => t.id === entry.id)!;
                  setIncludes({ ...(scheme.includes ?? allAppearanceParts) });
                  onPreview(applyAppearanceScheme(appearance, scheme));
                }
              }}
            >
              <strong>{entry.name}</strong>
              <small>
                {kind === 'color'
                  ? '颜色、密度与代码配色'
                  : Object.entries(
                      settings.themes.find((t) => t.id === entry.id)?.includes ??
                        allAppearanceParts,
                    )
                      .filter(([, yes]) => yes)
                      .map(
                        ([key]) =>
                          ({ colors: '颜色', fonts: '字体与排版', wallpaper: '壁纸与透明度' })[key],
                      )
                      .join(' · ')}
              </small>
            </button>
            <button
              aria-label={`删除 ${entry.name}`}
              onClick={() => {
                onDelete(kind, entry.id);
                if (selected === entry.id) setSelected('');
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      {!entries.length && (
        <p className="subtle">还没有自定义{kind === 'color' ? '颜色主题' : '完整外观方案'}。</p>
      )}
      <label
        className="scheme-name"
        data-setting-id="themeName"
        data-setting-label="方案名称"
        tabIndex={-1}
      >
        方案名称
        <input
          aria-label="方案名称"
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            onPending(e.target.value !== savedName);
          }}
        />
      </label>
      {kind === 'scheme' && (
        <fieldset className="scheme-parts">
          <legend>此方案包含</legend>
          {(['colors', 'fonts', 'wallpaper'] as const).map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={includes[key]}
                onChange={(e) => setIncludes({ ...includes, [key]: e.target.checked })}
              />
              {{ colors: '颜色与控件', fonts: '字体与排版', wallpaper: '壁纸与透明度' }[key]}
            </label>
          ))}
        </fieldset>
      )}
      <div className="settings-actions">
        <button
          disabled={!name.trim() || (kind === 'scheme' && !Object.values(includes).some(Boolean))}
          onClick={() => save(false)}
        >
          保存为新方案
        </button>
        <button
          disabled={
            !selection ||
            !name.trim() ||
            (kind === 'scheme' && !Object.values(includes).some(Boolean))
          }
          onClick={() => save(true)}
        >
          更新当前方案 / 重命名
        </button>
      </div>
    </section>
  );
}
