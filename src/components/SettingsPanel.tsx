import { useEffect, useMemo, useRef, useState } from 'react';
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
  FontCatalogEntry,
  FontEntry,
  HistoryStats,
  Settings,
  Template,
} from '../shared/types';
import { defaultAppearance, defaultSettings } from '../shared/defaults';
import { builtinPalettes, paletteAppearance } from '../shared/palettes';
import { appearanceColors, bytesLabel, errorText } from '../ui/model';
import { Field, IconButton, Modal, Toggle } from './Controls';
import { searchSettings, settingsGroups as groups } from '../ui/settingsSearch';

const appearanceLabels = {
  fontSize: '正文字号',
  lineHeight: '行距',
  codeFontSize: '代码字号',
  codeLineHeight: '代码行距',
  contentWidth: '正文宽度',
  wallpaperOpacity: '壁纸透明度',
  wallpaperBlur: '模糊',
  wallpaperBrightness: '亮度',
  editorOpacity: '正文底色透明度',
  sidebarOpacity: '侧栏底色透明度',
};
const shortcutLabels: Record<string, string> = {
  save: '保存',
  new: '新建',
  open: '打开',
  find: '查找',
  settings: '设置',
  mode: '切换源码',
};
const shortcutKey = (value: string) =>
  value
    .toLowerCase()
    .split('+')
    .map((key) => key.trim())
    .filter(Boolean)
    .sort()
    .join('+');
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
}: Props) {
  const [section, setSection] = useState('appearance');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const [excludedDraft, setExcludedDraft] = useState(settings.excluded.join('\n'));
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [fontQuery, setFontQuery] = useState('');
  const [original] = useState(() => structuredClone(settings.appearance));
  const [themeName, setThemeName] = useState('我的主题');
  const [catalog, setCatalog] = useState<FontCatalogEntry[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [templateId, setTemplateId] = useState(settings.templates[0]?.id || '');
  const [recordingShortcut, setRecordingShortcut] = useState('');
  const searching = Boolean(query.trim());
  const results = searchSettings(query);
  const visible = searching ? 'search' : section;
  useEffect(() => setExcludedDraft(settings.excluded.join('\n')), [settings.excluded]);
  useEffect(() => {
    if (!highlight || searching) return;
    const target = [
      ...(contentRef.current?.querySelectorAll<HTMLElement>('[data-setting-label]') || []),
    ].find((element) => element.dataset.settingLabel === highlight);
    if (!target) return;
    target.dataset.settingHighlighted = 'true';
    target.scrollIntoView?.({ block: 'center' });
    target.focus({ preventScroll: true });
    return () => {
      delete target.dataset.settingHighlighted;
    };
  }, [highlight, searching, section]);
  const appearance = settings.appearance;
  const colors = appearanceColors(
    appearance,
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  const template = settings.templates.find((item) => item.id === templateId);
  const displayedFonts = useMemo(
    () => fonts.filter((font) => font.name.toLowerCase().includes(fontQuery.toLowerCase())),
    [fonts, fontQuery],
  );
  const patch = (value: Partial<Settings>) => onChange({ ...settings, ...value });
  const look = (value: Partial<Appearance>) => patch({ appearance: { ...appearance, ...value } });
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
        aria-label={appearanceLabels[key]}
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
      pending={
        (themeName !== '我的主题' && Boolean(themeName.trim())) ||
        excludedDraft !== settings.excluded.join('\n')
      }
      wide
    >
      <div className="settings-search-bar">
        <div className="input-with-icon">
          <Search size={15} />
          <input
            aria-label="搜索设置"
            placeholder="搜索具体设置，如自动保存、代码字号…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
        <div ref={contentRef} className="settings-content">
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
          {visible === 'appearance' && (
            <>
              <h3>
                <Palette size={19} />
                外观与主题
              </h3>
              <p className="section-description">修改会立即显示，并保存在所有目录共用的设置中。</p>
              <Field
                label="内置配色"
                description="配色包含浅色和深色两版，保留字体、壁纸与布局设置。"
              >
                <div className="theme-list builtin-palettes">
                  {builtinPalettes.map((palette) => (
                    <button
                      key={palette.id}
                      aria-pressed={appearance.palette === palette.id}
                      onClick={() =>
                        patch({ appearance: paletteAppearance(appearance, palette.id) })
                      }
                    >
                      <span
                        className="theme-dot"
                        style={{ background: palette.light.bg, borderColor: palette.light.accent }}
                      />
                      {palette.name}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="明暗模式">
                <select
                  aria-label="明暗模式"
                  value={appearance.mode}
                  onChange={(e) => look({ mode: e.target.value as Appearance['mode'] })}
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                  <option value="system">跟随系统</option>
                </select>
              </Field>
              <div className="color-fields">
                {(
                  [
                    ['accent', '强调色'],
                    ['background', '背景色'],
                    ['foreground', '文字色'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} data-setting-label={label} tabIndex={-1}>
                    {label}
                    <input
                      aria-label={label}
                      type="color"
                      value={colors[key]}
                      onChange={(e) => {
                        if (!appearance.palette) {
                          look({ [key]: e.target.value });
                          return;
                        }
                        const mode = colors.dark ? 'dark' : 'light';
                        look({
                          paletteOverrides: {
                            ...appearance.paletteOverrides,
                            [mode]: {
                              ...appearance.paletteOverrides?.[mode],
                              [key]: e.target.value,
                            },
                          },
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
              <Field label="正文字号">{number('fontSize', 12, 28, 1, ' px')}</Field>
              <Field label="行距">{number('lineHeight', 1.2, 2.5, 0.05)}</Field>
              <Field label="正文宽度">{number('contentWidth', 480, 1200, 20, ' px')}</Field>
              <div
                className="appearance-preview"
                style={{
                  fontFamily: appearance.bodyFont,
                  fontSize: appearance.fontSize,
                  lineHeight: appearance.lineHeight,
                }}
              >
                <h4 style={{ fontFamily: appearance.headingFont }}>把想法写下来</h4>
                <p>
                  中文笔记与 English words，在同一张纸上自然相处。<strong>清晰的文字</strong>
                  ，留一点呼吸的空间。
                </p>
                <code style={{ fontFamily: appearance.codeFont }}>const idea = "从这里开始";</code>
                <p className="math-preview">∫₀¹ x² dx = ⅓</p>
              </div>
              <h4>静态壁纸</h4>
              <Field label="本地图片" description={appearance.wallpaper || '未选择壁纸'}>
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
              </Field>
              {appearance.wallpaper && (
                <>
                  <Field label="壁纸透明度">{number('wallpaperOpacity', 0, 1, 0.05)}</Field>
                  <Field label="模糊">{number('wallpaperBlur', 0, 30, 1, ' px')}</Field>
                  <Field label="亮度">{number('wallpaperBrightness', 0.3, 1.8, 0.05)}</Field>
                  <Field label="填充">
                    <select
                      aria-label="壁纸填充"
                      value={appearance.wallpaperFit}
                      onChange={(e) =>
                        look({ wallpaperFit: e.target.value as Appearance['wallpaperFit'] })
                      }
                    >
                      <option value="cover">填满</option>
                      <option value="contain">完整显示</option>
                      <option value="repeat">平铺</option>
                    </select>
                    <select
                      aria-label="壁纸位置"
                      value={appearance.wallpaperPosition}
                      onChange={(e) => look({ wallpaperPosition: e.target.value })}
                    >
                      <option value="center">居中</option>
                      <option value="top">顶部</option>
                      <option value="bottom">底部</option>
                      <option value="left">左侧</option>
                      <option value="right">右侧</option>
                    </select>
                  </Field>
                </>
              )}
              <Field label="正文底色透明度">{number('editorOpacity', 0, 1, 0.05)}</Field>
              <Field label="侧栏底色透明度">{number('sidebarOpacity', 0, 1, 0.05)}</Field>
              <h4 data-setting-label="已保存的主题" tabIndex={-1}>
                已保存的主题
              </h4>
              <div className="theme-list">
                {settings.themes.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => look({ ...theme.appearance, palette: theme.appearance.palette })}
                  >
                    <span
                      className="theme-dot"
                      style={{
                        background: theme.appearance.background,
                        borderColor: theme.appearance.accent,
                      }}
                    />
                    {theme.name}
                  </button>
                ))}
              </div>
              <div className="inline-form">
                <input
                  aria-label="主题名称"
                  value={themeName}
                  onChange={(e) => setThemeName(e.target.value)}
                />
                <button
                  disabled={!themeName.trim()}
                  onClick={() => {
                    patch({
                      themes: [
                        ...settings.themes,
                        {
                          id: crypto.randomUUID(),
                          name: themeName.trim(),
                          appearance: structuredClone(appearance),
                        },
                      ],
                    });
                    setThemeName('我的主题');
                    setMessage('已保存当前外观为独立主题');
                  }}
                >
                  保存 / 复制为主题
                </button>
              </div>
              <div className="settings-actions">
                <button onClick={() => look({ ...original })}>
                  <Undo2 size={14} />
                  撤销本次外观修改
                </button>
                <button onClick={() => look(structuredClone(defaultAppearance))}>
                  <RefreshCw size={14} />
                  恢复默认外观
                </button>
              </div>
            </>
          )}
          {visible === 'fonts' && (
            <>
              <h3>
                <Type size={19} />
                字体管理
              </h3>
              <p className="section-description">
                直接预览系统字体；导入和下载的字体仅在鸢笺内使用。
              </p>
              {(
                [
                  ['uiFont', '界面字体'],
                  ['bodyFont', '正文字体'],
                  ['headingFont', '标题字体'],
                  ['codeFont', '代码字体'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <select
                    aria-label={label}
                    value={appearance[key]}
                    onChange={(e) => look({ [key]: e.target.value })}
                  >
                    {!fonts.some((font) => font.name === appearance[key]) && (
                      <option>{appearance[key]}</option>
                    )}
                    {fonts.map((font) => (
                      <option key={font.id} value={font.name}>
                        {font.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
              <div className="font-actions" data-setting-label="导入字体 / ZIP" tabIndex={-1}>
                <div className="input-with-icon">
                  <Search size={14} />
                  <input
                    aria-label="搜索字体"
                    placeholder="搜索字体名称…"
                    value={fontQuery}
                    onChange={(e) => setFontQuery(e.target.value)}
                  />
                </div>
                <IconButton
                  disabled={Boolean(busy)}
                  label="刷新系统字体"
                  onClick={() =>
                    void run('刷新字体', async () => onFonts(await window.notes.getFonts(true)))
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
                  导入字体 / ZIP
                </button>
              </div>
              <div className="font-list">
                {displayedFonts.map((font) => (
                  <div className="font-row" key={font.id}>
                    <div>
                      <strong>{font.name}</strong>
                      <small>
                        {
                          {
                            system: '系统',
                            bundled: '内置 · 离线可用',
                            downloaded: '已下载 · 离线可用',
                            imported: '已导入 · 离线可用',
                          }[font.source]
                        }
                        {font.bytes ? ` · ${bytesLabel(font.bytes)}` : ''}
                      </small>
                      <p style={{ fontFamily: `"${font.name}"` }}>
                        鸢笺，记录每一个想法。 Aa 0123 ∑
                      </p>
                    </div>
                    {['downloaded', 'imported'].includes(font.source) && (
                      <button
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run('移除字体', async () => {
                            await window.notes.removeFont(font.id);
                            onFonts(await window.notes.getFonts());
                          })
                        }
                      >
                        移除
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <h4 data-setting-label="可按需下载的开源字体" tabIndex={-1}>
                可按需下载的开源字体
              </h4>
              {catalog.map((font) => (
                <div className="catalog-row" key={font.id}>
                  <div>
                    <strong>{font.name}</strong>
                    <p>{font.description}</p>
                    <button
                      className="text-button"
                      onClick={() =>
                        void run('打开字体许可', () => window.notes.openExternal(font.licenseUrl))
                      }
                    >
                      查看许可
                    </button>
                  </div>
                  <button
                    disabled={
                      Boolean(busy) ||
                      fonts.some((item) => item.name === font.name && item.source === 'downloaded')
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
              <Field
                label="自动保存"
                description="已选保存位置的笔记在编辑后自动写入；空白草稿保留在会话中。"
              >
                <Toggle
                  label="自动保存"
                  checked={settings.autoSave}
                  onChange={(autoSave) => patch({ autoSave })}
                />
              </Field>
              <Field label="代码字号">{number('codeFontSize', 10, 28, 1, ' px')}</Field>
              <Field label="代码行距">{number('codeLineHeight', 1.2, 2.4, 0.05)}</Field>
              {(
                [
                  ['codeLineNumbers', '代码行号'],
                  ['codeWrap', '代码自动换行'],
                  ['codeFold', '代码折叠'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Toggle
                    label={label}
                    checked={settings[key]}
                    onChange={(value) => patch({ [key]: value })}
                  />
                </Field>
              ))}
              <Field label="显示其他文件" description="默认目录仅展示笔记、附件与相关子目录。">
                <Toggle
                  label="显示其他文件"
                  checked={settings.showAllFiles}
                  onChange={(showAllFiles) => patch({ showAllFiles })}
                />
              </Field>
              <Field label="索引排除目录" description="每行一个目录名。">
                <textarea
                  aria-label="索引排除目录"
                  rows={5}
                  value={excludedDraft}
                  onChange={(e) => setExcludedDraft(e.target.value)}
                  onBlur={() => {
                    const excluded = excludedDraft.split(/\r?\n/).filter(Boolean);
                    setExcludedDraft(excluded.join('\n'));
                    if (excluded.join('\n') !== settings.excluded.join('\n')) patch({ excluded });
                  }}
                />
              </Field>
              <Field label="附件目录规则" description="相对笔记所在目录，如 assets。">
                <input
                  aria-label="附件目录规则"
                  value={settings.attachmentPattern}
                  onChange={(e) => patch({ attachmentPattern: e.target.value })}
                />
              </Field>
            </>
          )}
          {visible === 'layout' && (
            <>
              <h3>界面与快捷键</h3>
              {(
                [
                  ['leftVisible', '显示左侧导航'],
                  ['rightVisible', '显示右侧大纲'],
                  ['toolbarVisible', '显示编辑工具栏'],
                  ['statusVisible', '显示底部状态栏'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Toggle
                    label={label}
                    checked={settings[key]}
                    onChange={(value) => patch({ [key]: value })}
                  />
                </Field>
              ))}
              <h4 data-setting-label="工具栏按钮" tabIndex={-1}>
                工具栏按钮
              </h4>
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
              <h4 data-setting-label="应用快捷键" tabIndex={-1}>
                应用快捷键
              </h4>
              <p className="subtle">格式：Ctrl+s、Ctrl+Shift+m。输入框中按下组合键即可记录。</p>
              {Object.entries(settings.shortcuts).map(([key, value]) => (
                <Field
                  key={key}
                  label={shortcutLabels[key] || key}
                  description={
                    recordingShortcut === key
                      ? '正在录制：请按下组合键，Tab 移到下一项。'
                      : undefined
                  }
                >
                  <div className="shortcut-control">
                    <input
                      aria-label={`${shortcutLabels[key] || key}快捷键`}
                      value={value}
                      onFocus={() => setRecordingShortcut(key)}
                      onBlur={() => setRecordingShortcut('')}
                      onChange={(e) =>
                        patch({ shortcuts: { ...settings.shortcuts, [key]: e.target.value } })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Tab') return;
                        if (e.ctrlKey || e.metaKey || e.altKey) {
                          e.preventDefault();
                          if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
                          patch({
                            shortcuts: {
                              ...settings.shortcuts,
                              [key]: [
                                e.ctrlKey || e.metaKey ? 'Ctrl' : '',
                                e.altKey ? 'Alt' : '',
                                e.shiftKey ? 'Shift' : '',
                                e.key.toLowerCase(),
                              ]
                                .filter(Boolean)
                                .join('+'),
                            },
                          });
                        }
                      }}
                    />
                    <button
                      aria-label={`恢复${shortcutLabels[key] || key}默认快捷键`}
                      disabled={
                        !defaultSettings.shortcuts[key] || value === defaultSettings.shortcuts[key]
                      }
                      onClick={() =>
                        patch({
                          shortcuts: {
                            ...settings.shortcuts,
                            [key]: defaultSettings.shortcuts[key],
                          },
                        })
                      }
                    >
                      恢复默认
                    </button>
                    {value.trim() &&
                      Object.entries(settings.shortcuts).some(
                        ([other, binding]) =>
                          other !== key && shortcutKey(binding) === shortcutKey(value),
                      ) && (
                        <p className="inline-error" role="alert">
                          与
                          {Object.entries(settings.shortcuts)
                            .filter(
                              ([other, binding]) =>
                                other !== key && shortcutKey(binding) === shortcutKey(value),
                            )
                            .map(([other]) => `“${shortcutLabels[other] || other}”`)
                            .join('、')}
                          使用相同组合键，请重新录制或恢复默认。
                        </p>
                      )}
                  </div>
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
              <Field label="保留天数">
                <input
                  aria-label="历史保留天数"
                  type="number"
                  min={1}
                  max={3650}
                  value={settings.historyDays}
                  onChange={(e) => patch({ historyDays: Math.max(1, Number(e.target.value)) })}
                />
              </Field>
              <Field label="容量上限（MB）">
                <input
                  aria-label="历史容量上限"
                  type="number"
                  min={10}
                  max={100000}
                  value={settings.historyLimitMB}
                  onChange={(e) => patch({ historyLimitMB: Math.max(10, Number(e.target.value)) })}
                />
              </Field>
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
                data-setting-label="按当前规则清理历史"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run('清理历史', async () => setStats(await window.notes.pruneHistory()))
                }
              >
                按当前规则清理历史
              </button>
            </>
          )}
          {visible === 'templates' && (
            <>
              <h3>模板与片段</h3>
              <h4 data-setting-label="笔记模板" tabIndex={-1}>
                笔记模板
              </h4>
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
                  <Field label="模板名称">
                    <input
                      aria-label="模板名称"
                      value={template.name}
                      onChange={(e) => editTemplate({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="用途">
                    <select
                      aria-label="模板用途"
                      value={template.kind}
                      onChange={(e) => editTemplate({ kind: e.target.value as Template['kind'] })}
                    >
                      <option value="note">普通笔记</option>
                      <option value="daily">日记</option>
                      <option value="weekly">周记</option>
                      <option value="monthly">月记</option>
                    </select>
                  </Field>
                  <textarea
                    aria-label="模板正文"
                    rows={11}
                    value={template.content}
                    onChange={(e) => editTemplate({ content: e.target.value })}
                  />
                  <p className="subtle">变量：{'{{title}} {{date}} {{year}} {{month}} {{week}}'}</p>
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
              <h4 data-setting-label="公式片段" tabIndex={-1}>
                公式片段
              </h4>
              {settings.snippets.map((snippet, i) => (
                <div className="snippet-editor" key={i}>
                  <div className="inline-form">
                    <input
                      aria-label={`片段 ${i + 1} 触发词`}
                      value={snippet.trigger}
                      onChange={(e) =>
                        patch({
                          snippets: settings.snippets.map((item, j) =>
                            j === i ? { ...item, trigger: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <label>
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
                    aria-label={`片段 ${i + 1} 内容`}
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
                    snippets: [...settings.snippets, { trigger: 'new', body: '\\', enabled: true }],
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
              <Field
                label="日记文件夹"
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
              </Field>
              {(
                [
                  ['dailyPattern', '日记命名'],
                  ['weeklyPattern', '周记命名'],
                  ['monthlyPattern', '月记命名'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    aria-label={label}
                    value={settings[key]}
                    onChange={(e) => patch({ [key]: e.target.value })}
                  />
                </Field>
              ))}
              <p className="subtle">
                使用 / 分隔目录；支持 {'{{year}} {{month}} {{date}} {{week}}'}
                。日记默认开启，一天也可从模板新建多篇。
              </p>
              <Field label="启用周记">
                <Toggle
                  label="启用周记"
                  checked={settings.weeklyEnabled}
                  onChange={(weeklyEnabled) => patch({ weeklyEnabled })}
                />
              </Field>
              <Field label="启用月记">
                <Toggle
                  label="启用月记"
                  checked={settings.monthlyEnabled}
                  onChange={(monthlyEnabled) => patch({ monthlyEnabled })}
                />
              </Field>
              <p className="subtle">
                在“模板与片段”中编辑对应日 / 周 / 月模板；有多个时，创建前可选择。
              </p>
            </>
          )}
          <div className="settings-feedback" aria-live="polite">
            {busy ? `${busy}中…` : message}
          </div>
        </div>
      </div>
    </Modal>
  );
}
