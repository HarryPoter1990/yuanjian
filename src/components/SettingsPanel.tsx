import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  Download,
  FolderOpen,
  Palette,
  RefreshCw,
  Search,
  Settings2,
  Type,
  Undo2,
} from '../ui/icons';
import type {
  Appearance,
  AppearanceRemovals,
  FontCatalogEntry,
  FontEntry,
  HistoryStats,
  Settings,
  Template,
} from '../shared/types';
import { applyColorTheme, colorThemeSnapshot } from '../shared/appearance';
import { defaultAppearance, defaultSettings } from '../shared/defaults';
import { ThemeControls, AppearancePreview } from './ThemeControls';
import { AppearanceSchemes } from './AppearanceSchemes';
import { appearanceColors, bytesLabel, errorText } from '../ui/model';
import { Field, IconButton, Modal, Toggle } from './Controls';
import { ShortcutControl } from './ShortcutControl';
import { FontBrowser } from './FontBrowser';
import { FontPicker } from './FontPicker';
import { searchSettings, settingsGroups as groups } from '../ui/settingsSearch';
import {
  settingDefinitions,
  shortcutLabels,
  shortcutSetting,
  snippetSetting,
  type SettingId,
} from '../ui/settingsFields';

function SettingField({
  id,
  children,
  description,
}: {
  id: SettingId;
  children: ReactNode;
  description?: string;
}) {
  const entry = settingDefinitions[id];
  return (
    <Field
      label={entry.label}
      settingId={id}
      description={description ?? (entry.explain ? entry.description : undefined)}
    >
      {children}
    </Field>
  );
}
function SettingHeading({ id }: { id: SettingId }) {
  return (
    <h4 data-setting-id={id} data-setting-label={settingDefinitions[id].label} tabIndex={-1}>
      {settingDefinitions[id].label}
    </h4>
  );
}
const excludedLines = (value: string) => value.split(/\r?\n/).filter(Boolean);
const toolbarLabels: Record<string, string> = {
  heading: '标题',
  bold: '粗体',
  italic: '斜体',
  list: '列表',
  task: '任务',
  quote: '引用',
  code: '代码',
  math: '公式',
  table: '表格',
  link: '链接',
  image: '图片',
  diagram: '图表',
};
interface Props {
  settings: Settings;
  fonts: FontEntry[];
  dataDirectory: string;
  version: string;
  onChange(settings: Settings): void;
  onFonts(fonts: FontEntry[]): void;
  onClose(): void;
  onError(message: string): void;
  saveState: string;
  onPreview?(appearance: Appearance | null, dark?: boolean | null): void;
  onApplyAppearance?(appearance: Appearance, removals?: AppearanceRemovals): Promise<unknown>;
}
export function SettingsPanel({
  settings,
  fonts,
  dataDirectory,
  version,
  onChange,
  onFonts,
  onClose,
  onError,
  saveState,
  onPreview,
  onApplyAppearance,
}: Props) {
  const [section, setSection] = useState('appearance');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const excludedValue = settings.excluded.join('\n');
  const [excludedDraft, setExcludedDraft] = useState(excludedValue);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [original, setOriginal] = useState(() => structuredClone(settings.appearance));
  const [appearance, setAppearance] = useState(() => structuredClone(settings.appearance));
  const [previewRevision, setPreviewRevision] = useState(0);
  const committedAppearance = JSON.stringify(settings.appearance);
  const lastCommittedAppearance = useRef(committedAppearance);
  useEffect(() => {
    if (lastCommittedAppearance.current !== committedAppearance) {
      lastCommittedAppearance.current = committedAppearance;
      if (!dirty) {
        setAppearance(structuredClone(settings.appearance));
        setOriginal(structuredClone(settings.appearance));
      }
    }
  }, [committedAppearance]);
  const [previewDark, setPreviewDark] = useState<boolean | null>(
    () =>
      appearanceColors(
        settings.appearance,
        window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
      ).dark,
  );
  const [removals, setRemovals] = useState<AppearanceRemovals>({ colors: [], schemes: [] });
  const schemeSettings = {
    ...settings,
    colorThemes: (settings.colorThemes ?? []).filter((item) => !removals.colors.includes(item.id)),
    themes: settings.themes.filter((item) => !removals.schemes.includes(item.id)),
  };
  const [invalidColors, setInvalidColors] = useState<Record<string, boolean>>({});
  const dirty =
    JSON.stringify(original) !== JSON.stringify(appearance) ||
    removals.colors.length > 0 ||
    removals.schemes.length > 0;
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  useEffect(() => {
    onPreview?.(appearance, previewDark);
  }, [appearance, previewDark, onPreview]);
  useEffect(() => () => previewCallback.current?.(null, null), []);
  const replaceAppearance = (value: Appearance) => {
    setPreviewRevision((value) => value + 1);
    setInvalidColors({});
    setAppearance(structuredClone(value));
  };
  async function applyAppearance() {
    setBusy('应用外观');
    setMessage('');
    try {
      if (onApplyAppearance) await onApplyAppearance(appearance, removals);
      else onChange({ ...schemeSettings, appearance: structuredClone(appearance) });
      setRemovals({ colors: [], schemes: [] });
      setOriginal(structuredClone(appearance));
      setPreviewDark(null);
      setMessage('外观已应用并保存');
    } catch (error) {
      setMessage(`外观未应用：${errorText(error)}，预览保留，可重试`);
    } finally {
      setBusy('');
    }
  }
  const [catalog, setCatalog] = useState<FontCatalogEntry[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [schemePending, setSchemePending] = useState(false);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [templateId, setTemplateId] = useState(settings.templates[0]?.id || '');
  const searching = Boolean(query.trim());
  const results = searchSettings(query, settings);
  const visible = searching ? 'search' : section;
  useEffect(() => {
    setExcludedDraft((draft) =>
      excludedLines(draft).join('\n') === excludedValue ? draft : excludedValue,
    );
  }, [excludedValue]);
  useEffect(() => {
    if (!highlight || searching) return;
    const target = [
      ...(contentRef.current?.querySelectorAll<HTMLElement>('[data-setting-id]') || []),
    ].find((element) => element.dataset.settingId === highlight);
    if (!target) return;
    target.dataset.settingHighlighted = 'true';
    target.scrollIntoView?.({ block: 'center' });
    target.focus({ preventScroll: true });
    return () => {
      delete target.dataset.settingHighlighted;
    };
  }, [highlight, searching, section]);
  const colors = appearanceColors(
    previewDark === null ? appearance : { ...appearance, mode: previewDark ? 'dark' : 'light' },
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  const template = settings.templates.find((item) => item.id === templateId);
  const patch = (value: Partial<Settings>) => onChange({ ...settings, ...value });
  const stageAppearance = (value: Appearance) => {
    if (value.mode !== appearance.mode && value.mode !== 'system')
      setPreviewDark(value.mode === 'dark');
    else if (previewDark === null) setPreviewDark(colors.dark);
    setAppearance(value);
  };
  const look = (value: Partial<Appearance>) => stageAppearance({ ...appearance, ...value });
  function changeSchemes(value: Partial<Settings>) {
    // Ordinary list writes retain the currently applied entry until its staged deletion is applied.
    const next = { ...value };
    if (value.themes)
      next.themes = [
        ...value.themes,
        ...settings.themes.filter(
          (item) =>
            removals.schemes.includes(item.id) &&
            !value.themes!.some((entry) => entry.id === item.id),
        ),
      ];
    if (value.colorThemes)
      next.colorThemes = [
        ...value.colorThemes,
        ...(settings.colorThemes ?? []).filter(
          (item) =>
            removals.colors.includes(item.id) &&
            !value.colorThemes!.some((entry) => entry.id === item.id),
        ),
      ];
    patch(next);
  }
  function deleteScheme(kind: 'color' | 'scheme', id: string) {
    const appliedId =
      kind === 'color' ? settings.appearance.colorThemeId : settings.appearance.schemeId;
    if (appliedId === id) {
      const key = kind === 'color' ? 'colors' : 'schemes';
      setRemovals((current) => ({ ...current, [key]: [...current[key], id] }));
      setMessage('当前方案将在应用外观时删除；取消预览可撤回。');
    } else if (kind === 'color')
      patch({ colorThemes: (settings.colorThemes ?? []).filter((item) => item.id !== id) });
    else patch({ themes: settings.themes.filter((item) => item.id !== id) });
    if (
      appliedId === id ||
      (kind === 'color' ? appearance.colorThemeId : appearance.schemeId) === id
    )
      replaceAppearance({
        ...applyColorTheme(appearance, {
          id: '',
          name: '内置',
          appearance: colorThemeSnapshot(defaultAppearance),
        }),
        schemeId: undefined,
      });
  }
  async function run(label: string, action: () => Promise<void | boolean>) {
    setBusy(label);
    setMessage('');
    try {
      const result = await action();
      setMessage(result === false ? '已取消，未作修改' : `${label}完成`);
    } catch (error) {
      const value = errorText(error);
      setMessage(value);
      onError(value);
    } finally {
      setBusy('');
    }
  }
  useEffect(() => {
    if (visible === 'fonts')
      void window.notes
        .getFontCatalog()
        .then(setCatalog)
        .catch((error) => onError(errorText(error)));
    if (visible === 'history')
      void window.notes
        .historyStats()
        .then(setStats)
        .catch((error) => onError(errorText(error)));
  }, [visible]);
  function editTemplate(value: Partial<Template>) {
    if (template)
      patch({
        templates: settings.templates.map((item) =>
          item.id === template.id ? { ...item, ...value } : item,
        ),
      });
  }
  const number = (
    key:
      | 'fontSize'
      | 'lineHeight'
      | 'codeFontSize'
      | 'codeLineHeight'
      | 'contentWidth'
      | 'wallpaperOpacity'
      | 'wallpaperBlur'
      | 'wallpaperBrightness'
      | 'editorOpacity'
      | 'sidebarOpacity',
    min: number,
    max: number,
    step: number,
    suffix = '',
  ) => (
    <label className="range-control">
      <input
        type="range"
        aria-label={settingDefinitions[key].label}
        min={min}
        max={max}
        step={step}
        value={appearance[key] ?? (key === 'codeFontSize' ? 16 : 1.6)}
        onChange={(e) => look({ [key]: Number(e.target.value) })}
      />
      <output>
        {appearance[key] ?? (key === 'codeFontSize' ? 16 : 1.6)}
        {suffix}
      </output>
    </label>
  );
  return (
    <Modal
      title="设置"
      onClose={onClose}
      busy={Boolean(busy)}

      pending={schemePending}
      wide
    >
      <div className="settings-search-bar">
        <div className="input-with-icon">
          <Search size={15} />
          <input
            aria-label="搜索设置"
            placeholder="搜索具体设置，如自动保存、代码字号…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery('');
              }
            }}
          />
          {query && (
            <button className="text-button" aria-label="清除设置搜索" onClick={() => setQuery('')}>
              清除
            </button>
          )}
        </div>
      </div>
      <div className="settings-layout">
        <button
          className="settings-categories-toggle"
          aria-expanded={categoriesOpen}
          aria-controls="settings-categories"
          onClick={() => setCategoriesOpen(!categoriesOpen)}
        >
          {groups.find((group) => group.id === visible)?.label || '设置分类'}
          <ChevronRight size={16} />
        </button>
        <nav
          id="settings-categories"
          className={`settings-nav ${categoriesOpen ? 'settings-nav-open' : ''}`}
          aria-label="设置分组"
        >
          {groups.map((group) => (
            <button
              key={group.id}
              className={visible === group.id ? 'active' : ''}
              onClick={() => {
                setSection(group.id);
                setQuery('');
                setHighlight('');
                setCategoriesOpen(false);
              }}
            >
              {group.label}
              <ChevronRight size={13} />
            </button>
          ))}
          <div className="settings-about">
            <span className="brand-mark">鸢笺</span>
            <span>Yuanjian</span>
            <span>版本 {version}</span>
            <button
              onClick={() => void run('打开数据目录', () => window.notes.revealPath(dataDirectory))}
            >
              打开应用数据目录
            </button>
            <p aria-live="polite">{saveState}</p>
            {saveState.includes('失败') && (
              <button onClick={() => onChange({ ...settings })}>重试保存设置</button>
            )}
          </div>
        </nav>
        <div className="settings-main">
          <div ref={contentRef} className="settings-content">
            <fieldset className="settings-fields" disabled={Boolean(busy)}>
              {searching && (
                <div className="settings-search-results">
                  <h3>搜索设置</h3>
                  <p className="section-description" role="status">
                    找到 {results.length} 项设置
                  </p>
                  {results.map((item) => (
                    <button
                      key={`${item.section}:${item.label}`}
                      aria-label={`${item.group} · ${item.label}`}
                      onClick={() => {
                        setSection(item.section);
                        setQuery('');
                        setCategoriesOpen(false);
                        setHighlight(item.target);
                      }}
                    >
                      <span className="setting-result-category">{item.group}</span>
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  {!results.length && (
                    <p className="empty-state">没有匹配的设置。试试设置名称或用途。</p>
                  )}
                </div>
              )}
              <div hidden={visible !== 'appearance'}>
                <h3>
                  <Palette size={19} />
                  外观与主题
                </h3>
                <ThemeControls
                  key={previewRevision}
                  revealAdvanced={highlight}
                  invalidColors={Object.values(invalidColors).some(Boolean)}
                  appearance={appearance}
                  onChange={stageAppearance}
                  previewDark={colors.dark}
                  onPreviewDark={setPreviewDark}
                  onValidity={(key, invalid) =>
                    setInvalidColors((current) => ({ ...current, [key]: invalid }))
                  }
                />
                <SettingField id="fontSize">{number('fontSize', 12, 28, 1, ' px')}</SettingField>
                <SettingField id="lineHeight">{number('lineHeight', 1.2, 2.5, 0.05)}</SettingField>
                <SettingField id="contentWidth">
                  {number('contentWidth', 480, 1200, 20, ' px')}
                </SettingField>
                <AppearanceSchemes
                  settings={schemeSettings}
                  appearance={appearance}
                  onChange={changeSchemes}
                  onDelete={deleteScheme}
                  onPreview={replaceAppearance}
                  onPending={setSchemePending}
                />
                <div className="settings-actions">
                  <button
                    onClick={() => {
                      setRemovals({ colors: [], schemes: [] });
                      replaceAppearance(original);
                      setPreviewDark(null);
                    }}
                  >
                    <Undo2 size={14} />
                    撤销本次外观修改
                  </button>
                  <button onClick={() => replaceAppearance(defaultAppearance)}>
                    <RefreshCw size={14} />
                    恢复默认外观
                  </button>
                </div>
              </div>
              <section hidden={visible !== 'wallpaper'}>
                <h3>
                  <Palette size={19} />
                  壁纸
                </h3>
                <p className="section-description">
                  本地壁纸与透明度独立设置，预览后点击“应用外观”保存。
                </p>
                <h4>静态壁纸</h4>
                <SettingField id="wallpaper" description={appearance.wallpaper || '未选择壁纸'}>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run('选择壁纸', async () => {
                        const path = await window.notes.chooseWallpaper();
                        if (!path) return false;
                        look({ wallpaper: path });
                      })
                    }
                  >
                    <FolderOpen size={14} />
                    选择图片
                  </button>
                  {appearance.wallpaper && (
                    <button onClick={() => look({ wallpaper: '' })}>移除</button>
                  )}
                </SettingField>
                {appearance.wallpaper && (
                  <>
                    <SettingField id="wallpaperOpacity">
                      {number('wallpaperOpacity', 0, 1, 0.05)}
                    </SettingField>
                    <SettingField id="wallpaperBlur">
                      {number('wallpaperBlur', 0, 30, 1, ' px')}
                    </SettingField>
                    <SettingField id="wallpaperBrightness">
                      {number('wallpaperBrightness', 0.3, 1.8, 0.05)}
                    </SettingField>
                    <SettingField id="wallpaperFit">
                      <select
                        aria-label={settingDefinitions.wallpaperFit.label}
                        value={appearance.wallpaperFit}
                        onChange={(e) =>
                          look({ wallpaperFit: e.target.value as Appearance['wallpaperFit'] })
                        }
                      >
                        <option value="cover">填满</option>
                        <option value="contain">完整显示</option>
                        <option value="repeat">平铺</option>
                      </select>
                    </SettingField>
                    <SettingField id="wallpaperPosition">
                      <select
                        aria-label={settingDefinitions.wallpaperPosition.label}
                        value={appearance.wallpaperPosition}
                        onChange={(e) => look({ wallpaperPosition: e.target.value })}
                      >
                        <option value="center">居中</option>
                        <option value="top">顶部</option>
                        <option value="bottom">底部</option>
                        <option value="left">左侧</option>
                        <option value="right">右侧</option>
                      </select>
                    </SettingField>
                  </>
                )}
                <SettingField id="editorOpacity">
                  {number('editorOpacity', 0, 1, 0.05)}
                </SettingField>
                <SettingField id="sidebarOpacity">
                  {number('sidebarOpacity', 0, 1, 0.05)}
                </SettingField>
              </section>
              {visible === 'fonts' && (
                <>
                  <h3>
                    <Type size={19} />
                    字体管理
                  </h3>
                  <p className="section-description">
                    内置和我的字体优先显示，系统字体可展开或搜索。导入和下载的字体仅在鸢笺内使用。
                  </p>
                  {(['uiFont', 'bodyFont', 'headingFont', 'codeFont'] as const).map((key) => (
                    <SettingField
                      key={key}
                      id={key}
                      description={settingDefinitions[key].description}
                    >
                      <FontPicker
                        label={settingDefinitions[key].label}
                        value={appearance[key]}
                        fonts={fonts}
                        onChange={(value) => look({ [key]: value })}
                      />
                    </SettingField>
                  ))}
                  <div
                    data-setting-id="fontImport"
                    data-setting-label={settingDefinitions.fontImport.label}
                    tabIndex={-1}
                  >
                    <FontBrowser
                      fonts={fonts}
                      selected={[
                        appearance.uiFont,
                        appearance.bodyFont,
                        appearance.headingFont,
                        appearance.codeFont,
                      ]}
                      disabled={Boolean(busy)}
                      onRemove={(font) =>
                        void run('移除字体', async () => {
                          await window.notes.removeFont(font.id);
                          onFonts(await window.notes.getFonts());
                        })
                      }
                      actions={
                        <>
                          <IconButton
                            disabled={Boolean(busy)}
                            label="刷新系统字体"
                            onClick={() =>
                              void run('刷新字体', async () =>
                                onFonts(await window.notes.getFonts(true)),
                              )
                            }
                          >
                            <RefreshCw size={16} />
                          </IconButton>
                          <button
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void run('导入字体', async () => {
                                const imported = await window.notes.importFonts();
                                if (!imported.length) return false;
                                onFonts(await window.notes.getFonts());
                              })
                            }
                          >
                            {settingDefinitions.fontImport.label}
                          </button>
                        </>
                      }
                    />
                  </div>
                  <SettingHeading id="fontDownloads" />
                  {catalog.map((font) => (
                    <div className="catalog-row" key={font.id}>
                      <div>
                        <strong>{font.name}</strong>
                        <p>{font.description}</p>
                        <button
                          className="text-button"
                          onClick={() =>
                            void run('打开字体许可', () =>
                              window.notes.openExternal(font.licenseUrl),
                            )
                          }
                        >
                          查看许可
                        </button>
                      </div>
                      <button
                        disabled={
                          Boolean(busy) ||
                          fonts.some(
                            (item) => item.name === font.name && item.source === 'downloaded',
                          )
                        }
                        onClick={() =>
                          void run(`下载 ${font.name}`, async () => {
                            await window.notes.downloadFont(font.id);
                            onFonts(await window.notes.getFonts());
                          })
                        }
                      >
                        {fonts.some(
                          (item) => item.name === font.name && item.source === 'downloaded',
                        ) ? (
                          <Check size={14} />
                        ) : (
                          <Download size={14} />
                        )}
                        下载
                      </button>
                    </div>
                  ))}
                </>
              )}
              {visible === 'editor' && (
                <>
                  <h3>
                    <Settings2 size={19} />
                    编辑与文件
                  </h3>
                  <SettingField id="autoSave">
                    <Toggle
                      label="自动保存"
                      checked={settings.autoSave}
                      onChange={(autoSave) => patch({ autoSave })}
                    />
                  </SettingField>
                  <SettingField id="codeFontSize">
                    {number('codeFontSize', 10, 28, 1, ' px')}
                  </SettingField>
                  <SettingField id="codeLineHeight">
                    {number('codeLineHeight', 1.2, 2.4, 0.05)}
                  </SettingField>
                  {(['codeLineNumbers', 'codeWrap', 'codeFold'] as const).map((key) => (
                    <SettingField key={key} id={key}>
                      <Toggle
                        label={settingDefinitions[key].label}
                        checked={settings[key]}
                        onChange={(value) => patch({ [key]: value })}
                      />
                    </SettingField>
                  ))}
                  <SettingField id="showAllFiles">
                    <Toggle
                      label="显示其他文件"
                      checked={settings.showAllFiles}
                      onChange={(showAllFiles) => patch({ showAllFiles })}
                    />
                  </SettingField>
                  <SettingField id="excluded">
                    <textarea
                      aria-label="索引排除目录"
                      rows={5}
                      value={excludedDraft}
                      onChange={(e) => {
                        const draft = e.target.value;
                        setExcludedDraft(draft);
                        const excluded = excludedLines(draft);
                        if (excluded.join('\n') !== excludedValue) patch({ excluded });
                      }}
                      onBlur={() => {
                        setExcludedDraft(excludedLines(excludedDraft).join('\n'));
                      }}
                    />
                  </SettingField>
                  <SettingField id="attachmentPattern">
                    <input
                      aria-label="附件目录规则"
                      value={settings.attachmentPattern}
                      onChange={(e) => patch({ attachmentPattern: e.target.value })}
                    />
                  </SettingField>
                </>
              )}
              {visible === 'layout' && (
                <>
                  <h3>界面与快捷键</h3>
                  {(
                    ['leftVisible', 'rightVisible', 'toolbarVisible', 'statusVisible'] as const
                  ).map((key) => (
                    <SettingField key={key} id={key}>
                      <Toggle
                        label={settingDefinitions[key].label}
                        checked={settings[key]}
                        onChange={(value) => patch({ [key]: value })}
                      />
                    </SettingField>
                  ))}
                  <SettingHeading id="toolbarButtons" />
                  <div className="check-grid">
                    {Object.entries(toolbarLabels).map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={settings.toolbarButtons.includes(key)}
                          onChange={(e) =>
                            patch({
                              toolbarButtons: e.target.checked
                                ? [...settings.toolbarButtons, key]
                                : settings.toolbarButtons.filter((item) => item !== key),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      patch({
                        leftVisible: true,
                        rightVisible: true,
                        toolbarVisible: true,
                        statusVisible: true,
                        toolbarButtons: [...defaultSettings.toolbarButtons],
                      })
                    }
                  >
                    恢复全部默认区块和按钮
                  </button>
                  <SettingHeading id="shortcuts" />
                  <p className="subtle">格式：Ctrl+s、Ctrl+Shift+m。输入框中按下组合键即可记录。</p>
                  <p className="subtle">
                    Ctrl+Tab / Ctrl+Shift+Tab 切换标签，Ctrl+W
                    关闭当前笔记。聚焦标签栏后，可用左右方向键或 Home / End 导航。
                  </p>
                  {Object.entries(settings.shortcuts).map(([key, value]) => (
                    <Field
                      key={key}
                      settingId={shortcutSetting(key).id}
                      label={shortcutSetting(key).label}
                    >
                      <ShortcutControl
                        action={key}
                        bindings={settings.shortcuts}
                        defaultValue={defaultSettings.shortcuts[key]}
                        onChange={(shortcuts) => patch({ shortcuts })}
                      />
                    </Field>
                  ))}
                </>
              )}
              {visible === 'history' && (
                <>
                  <h3>历史与恢复</h3>
                  <p className="section-description">
                    只记录实际编辑过的笔记。清理历史不会删除原笔记和源附件。
                  </p>
                  <SettingField id="historyDays">
                    <input
                      aria-label="历史保留天数"
                      type="number"
                      min={1}
                      max={3650}
                      value={settings.historyDays}
                      onChange={(e) => patch({ historyDays: Math.max(1, Number(e.target.value)) })}
                    />
                  </SettingField>
                  <SettingField id="historyLimitMB">
                    <input
                      aria-label="历史容量上限"
                      type="number"
                      min={10}
                      max={100000}
                      value={settings.historyLimitMB}
                      onChange={(e) =>
                        patch({ historyLimitMB: Math.max(10, Number(e.target.value)) })
                      }
                    />
                  </SettingField>
                  {stats && (
                    <div className="history-stats">
                      <div>
                        <strong>{stats.count}</strong>
                        <small>个版本</small>
                      </div>
                      <div>
                        <strong>{bytesLabel(stats.textBytes)}</strong>
                        <small>文字</small>
                      </div>
                      <div>
                        <strong>{bytesLabel(stats.imageBytes)}</strong>
                        <small>去重图片</small>
                      </div>
                      <progress
                        aria-label="历史占用容量"
                        max={settings.historyLimitMB * 1024 * 1024}
                        value={stats.totalBytes}
                      />
                      <p>
                        {bytesLabel(stats.totalBytes)} / {settings.historyLimitMB} MB
                      </p>
                      {stats.warning && <p className="inline-error">{stats.warning}</p>}
                    </div>
                  )}
                  <p className="subtle">
                    存在的笔记至少保留最近版本和固定版本；已删除笔记从删除日起计时，容量不足时可能提前淘汰。
                  </p>
                  <button
                    data-setting-id="historyPrune"
                    data-setting-label={settingDefinitions.historyPrune.label}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run('清理历史', async () => setStats(await window.notes.pruneHistory()))
                    }
                  >
                    {settingDefinitions.historyPrune.label}
                  </button>
                </>
              )}
              {visible === 'templates' && (
                <>
                  <h3>模板与片段</h3>
                  <SettingHeading id="templates" />
                  <div className="inline-form">
                    <select
                      aria-label="选择模板"
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                    >
                      {settings.templates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const id = crypto.randomUUID();
                        patch({
                          templates: [
                            ...settings.templates,
                            { id, name: '新模板', kind: 'note', content: '# {{title}}\n\n' },
                          ],
                        });
                        setTemplateId(id);
                      }}
                    >
                      新增模板
                    </button>
                  </div>
                  {template && (
                    <div className="template-editor">
                      <SettingField id="templateName">
                        <input
                          aria-label="模板名称"
                          value={template.name}
                          onChange={(e) => editTemplate({ name: e.target.value })}
                        />
                      </SettingField>
                      <SettingField id="templateKind">
                        <select
                          aria-label="模板用途"
                          value={template.kind}
                          onChange={(e) =>
                            editTemplate({ kind: e.target.value as Template['kind'] })
                          }
                        >
                          <option value="note">普通笔记</option>
                          <option value="daily">日记</option>
                          <option value="weekly">周记</option>
                          <option value="monthly">月记</option>
                        </select>
                      </SettingField>
                      <textarea
                        data-setting-id="templateContent"
                        data-setting-label={settingDefinitions.templateContent.label}
                        aria-label={settingDefinitions.templateContent.label}
                        rows={11}
                        value={template.content}
                        onChange={(e) => editTemplate({ content: e.target.value })}
                      />
                      <p className="subtle">
                        变量：{'{{title}} {{date}} {{year}} {{month}} {{week}}'}
                      </p>
                      <button
                        className="danger-text"
                        onClick={() => {
                          patch({
                            templates: settings.templates.filter((item) => item.id !== template.id),
                          });
                          setTemplateId(
                            settings.templates.find((item) => item.id !== template.id)?.id || '',
                          );
                        }}
                      >
                        删除此模板
                      </button>
                    </div>
                  )}
                  <SettingHeading id="snippets" />
                  {settings.snippets.map((snippet, i) => (
                    <div className="snippet-editor" key={i}>
                      <div className="inline-form">
                        <input
                          data-setting-id={snippetSetting(i, 'trigger').id}
                          data-setting-label={snippetSetting(i, 'trigger').label}
                          aria-label={snippetSetting(i, 'trigger').label}
                          value={snippet.trigger}
                          onChange={(e) =>
                            patch({
                              snippets: settings.snippets.map((item, j) =>
                                j === i ? { ...item, trigger: e.target.value } : item,
                              ),
                            })
                          }
                        />
                        <label
                          data-setting-id={snippetSetting(i, 'enabled').id}
                          data-setting-label={snippetSetting(i, 'enabled').label}
                          tabIndex={-1}
                        >
                          <input
                            type="checkbox"
                            checked={snippet.enabled}
                            onChange={(e) =>
                              patch({
                                snippets: settings.snippets.map((item, j) =>
                                  j === i ? { ...item, enabled: e.target.checked } : item,
                                ),
                              })
                            }
                          />
                          启用
                        </label>
                        <button
                          onClick={() =>
                            patch({ snippets: settings.snippets.filter((_, j) => j !== i) })
                          }
                        >
                          删除
                        </button>
                      </div>
                      <textarea
                        data-setting-id={snippetSetting(i, 'body').id}
                        data-setting-label={snippetSetting(i, 'body').label}
                        aria-label={snippetSetting(i, 'body').label}
                        rows={3}
                        value={snippet.body}
                        onChange={(e) =>
                          patch({
                            snippets: settings.snippets.map((item, j) =>
                              j === i ? { ...item, body: e.target.value } : item,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      patch({
                        snippets: [
                          ...settings.snippets,
                          { trigger: 'new', body: '\\', enabled: true },
                        ],
                      })
                    }
                  >
                    新增片段
                  </button>
                </>
              )}
              {visible === 'journal' && (
                <>
                  <h3>日记与周期</h3>
                  <SettingField
                    id="journalDirectory"
                    description={settings.journalDirectory || '未选择，首次创建时询问'}
                  >
                    <button
                      onClick={() =>
                        void run('选择日记目录', async () => {
                          const path = await window.notes.selectDirectory();
                          if (!path) return false;
                          patch({ journalDirectory: path });
                        })
                      }
                    >
                      <FolderOpen size={14} />
                      选择目录
                    </button>
                  </SettingField>
                  {(['dailyPattern', 'weeklyPattern', 'monthlyPattern'] as const).map((key) => (
                    <SettingField key={key} id={key}>
                      <input
                        aria-label={settingDefinitions[key].label}
                        value={settings[key]}
                        onChange={(e) => patch({ [key]: e.target.value })}
                      />
                    </SettingField>
                  ))}
                  <p className="subtle">
                    使用 / 分隔目录；支持 {'{{year}} {{month}} {{date}} {{week}}'}
                    。日记默认开启，一天也可从模板新建多篇。
                  </p>
                  <SettingField id="weeklyEnabled">
                    <Toggle
                      label="启用周记"
                      checked={settings.weeklyEnabled}
                      onChange={(weeklyEnabled) => patch({ weeklyEnabled })}
                    />
                  </SettingField>
                  <SettingField id="monthlyEnabled">
                    <Toggle
                      label="启用月记"
                      checked={settings.monthlyEnabled}
                      onChange={(monthlyEnabled) => patch({ monthlyEnabled })}
                    />
                  </SettingField>
                  <p className="subtle">
                    在“模板与片段”中编辑对应日 / 周 / 月模板；有多个时，创建前可选择。
                  </p>
                </>
              )}
            </fieldset>
            <div className="settings-feedback" aria-live="polite">
              {busy ? `${busy}中…` : message}
            </div>
          </div>
          <AppearancePreview
            hidden={!['appearance', 'fonts', 'wallpaper', 'editor'].includes(visible)}
            appearance={appearance}
            dark={colors.dark}
          />
        </div>
      </div>
      <footer className="appearance-footer">
        <span role="status">
          {Object.values(invalidColors).some(Boolean)
            ? '请先修正颜色输入'
            : dirty
              ? '外观尚未应用'
              : '外观与已应用设置一致'}
        </span>
        <button
          disabled={Boolean(busy)}
          onClick={() => {
            setRemovals({ colors: [], schemes: [] });
            replaceAppearance(original);
            setPreviewDark(null);
          }}
        >
          取消预览
        </button>
        <button
          className="primary"
          disabled={Boolean(busy) || Object.values(invalidColors).some(Boolean)}
          onClick={() => void applyAppearance()}
        >
          应用外观
        </button>
      </footer>
    </Modal>
  );
}
