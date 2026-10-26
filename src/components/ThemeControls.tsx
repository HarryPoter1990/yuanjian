import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Appearance, AppearanceColor } from '../shared/types';
import { builtinPalettes, paletteAppearance } from '../shared/palettes';
import { codeThemes, contrastRatio, syntaxColors } from '../shared/appearance';
import { appearanceColors } from '../ui/model';
import { renderMarkdown } from '../editor/renderer';

const labels: Record<AppearanceColor, string> = {
  accent: '强调色',
  background: '背景色',
  foreground: '文字色',
  sidebar: '侧栏底色',
  surface: '控件底色',
  muted: '辅助文字',
  border: '分割线',
  selected: '选区底色',
};
function ColorControl({
  label,
  value,
  onChange,
  onReset,
  onValidity,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  onReset(): void;
  onValidity(invalid: boolean): void;
}) {
  const [invalid, setInvalid] = useState('');
  const validity = useRef(onValidity);
  validity.current = onValidity;
  useEffect(() => () => validity.current(false), []);
  useEffect(() => {
    setInvalid('');
    validity.current(false);
  }, [value]);
  const hex = /^#[\da-f]{6}$/i.test(value) ? value : '#808080';
  return (
    <div className="color-control">
      <label>
        {label}
        <span className="color-inputs">
          <input
            type="color"
            aria-label={label}
            value={hex}
            onChange={(e) => {
              setInvalid('');
              onValidity(false);
              onChange(e.target.value);
            }}
          />
          <input
            aria-label={`${label} HEX`}
            value={invalid || value}
            spellCheck={false}
            aria-invalid={Boolean(invalid)}
            onChange={(e) => {
              const next = e.target.value;
              if (/^#[\da-f]{6}$/i.test(next)) {
                setInvalid('');
                onValidity(false);
                onChange(next);
              } else {
                setInvalid(next || ' ');
                onValidity(true);
              }
            }}
          />
        </span>
      </label>
      <button
        aria-label={`还原${label}`}
        onClick={() => {
          setInvalid('');
          onValidity(false);
          onReset();
        }}
      >
        还原
      </button>
      {invalid && <small role="alert">请输入 #RRGGBB</small>}
    </div>
  );
}
const sample =
  '# 把想法写下来\n\n中文笔记与 English words，自然相处。**清晰的文字**，留一点呼吸的空间。\n\n- [x] 留住今天的灵感\n- [ ] 明天继续\n\n```javascript\n// 一点小小的开始\nconst idea = "从这里开始";\nreturn idea.length + 1;\n```\n\n| 计划 | 状态 |\n| --- | --- |\n| 阅读与记录 | 进行中 |\n\n$E = mc^2$';

export const AppearancePreview = memo(function AppearancePreview({
  appearance,
  dark,
  hidden,
}: {
  appearance: Appearance;
  dark: boolean;
  hidden?: boolean;
}) {
  const sampleHTML = useMemo(
    () =>
      renderMarkdown(sample, {
        codeFontSize: appearance.codeFontSize,
        codeLineHeight: appearance.codeLineHeight,
      }),
    [appearance.codeFontSize, appearance.codeLineHeight],
  );
  const c = appearanceColors({ ...appearance, mode: dark ? 'dark' : 'light' }, dark);
  return (
    <aside
      hidden={hidden}
      className={`appearance-live-preview ${dark ? 'dark' : ''}`}
      aria-label="外观小预览"
      style={
        {
          '--background': c.background,
          '--foreground': c.foreground,
          '--accent': c.accent,
          '--accent-text': c.accentText,
          '--sidebar': c.sidebar,
          '--surface': c.surface,
          '--muted': c.muted,
          '--border': c.border,
          '--selected': c.selected,
          '--body-font': `"${appearance.bodyFont}",sans-serif`,
          '--heading-font': `"${appearance.headingFont}",sans-serif`,
          '--code-font': `"${appearance.codeFont}",monospace`,
          ...syntaxColors(appearance.codeTheme, dark),
        } as CSSProperties
      }
    >
      <div className="preview-title">
        即时预览 <span>{dark ? '深色' : '浅色'}</span>
      </div>
      <div className="preview-window">
        <div className="preview-sidebar">
          文件
          <br />
          今天的想法
        </div>
        <div className="preview-document">
          <div className="preview-tab">今天的想法.md</div>
          <article
            inert
            className="markdown-rendered"
            style={{
              fontFamily: appearance.bodyFont,
              fontSize: appearance.fontSize,
              lineHeight: appearance.lineHeight,
            }}
            dangerouslySetInnerHTML={{ __html: sampleHTML }}
          />
        </div>
      </div>
      <div className="preview-controls">
        <button className="primary" type="button" tabIndex={-1}>
          主按钮
        </button>
        <button type="button" tabIndex={-1}>
          普通按钮
        </button>
        <span>辅助文字</span>
      </div>
      <p>整体效果同步显示在后方窗口。预览不写入正式设置。</p>
    </aside>
  );
});
export function ThemeControls({
  revealAdvanced,
  invalidColors,
  appearance,
  onChange,
  previewDark,
  onPreviewDark,
  onValidity,
}: {
  revealAdvanced?: string;
  invalidColors: boolean;
  appearance: Appearance;
  onChange(value: Appearance): void;
  previewDark: boolean;
  onPreviewDark(value: boolean): void;
  onValidity(key: string, invalid: boolean): void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [collapsedHighlight, setCollapsedHighlight] = useState('');
  const advancedOpen =
    advanced ||
    Boolean(
      revealAdvanced &&
      collapsedHighlight !== revealAdvanced &&
      ['background', 'foreground', 'sidebar', 'surface', 'muted', 'border', 'selected'].includes(
        revealAdvanced,
      ),
    );
  const colors = appearanceColors(
    { ...appearance, mode: previewDark ? 'dark' : 'light' },
    previewDark,
  );
  const mode = previewDark ? 'dark' : 'light';
  const resolved: Record<AppearanceColor, string> = {
    accent: colors.accent,
    background: colors.background,
    foreground: colors.foreground,
    sidebar: colors.sidebar,
    surface: colors.surface,
    muted: colors.muted,
    border: colors.border,
    selected: colors.selected,
  };
  function setColor(key: AppearanceColor, value?: string) {
    const overrides = { ...appearance.paletteOverrides?.[mode] };
    if (value === undefined) delete overrides[key];
    else overrides[key] = value;
    onChange({
      ...appearance,
      paletteOverrides: { ...appearance.paletteOverrides, [mode]: overrides },
    });
  }
  const contrastChecks = [
    ['正文', colors.foreground, colors.background],
    ['侧栏文字', colors.foreground, colors.sidebar],
    ['辅助文字', colors.muted, colors.background],
    ['控件文字', colors.foreground, colors.surface],
  ]
    .map(([label, fg, bg]) => ({ label, ratio: contrastRatio(fg, bg) }))
    .filter((item) => item.ratio !== null && item.ratio < 4.5);
  return (
    <>
      <p className="section-description">
        配色只调整颜色与控件，保留字体和壁纸。所有外观修改需点击“应用外观”保存。
      </p>
      <div
        className="theme-cards"
        data-setting-id="palettes"
        data-setting-label="内置配色"
        tabIndex={-1}
      >
        {builtinPalettes.map((p) => (
          <button
            key={p.id}
            disabled={invalidColors}
            aria-pressed={
              appearance.palette === p.id && !appearance.paletteByMode && !appearance.colorThemeId
            }
            onClick={() => onChange(paletteAppearance(appearance, p.id))}
          >
            <span className="palette-pair">
              <i style={{ background: p.light.bg, color: p.light.fg }}>Aa</i>
              <i style={{ background: p.dark.bg, color: p.dark.fg }}>Aa</i>
            </span>
            <strong>{p.name}</strong>
            <small>浅色 / 深色</small>
          </button>
        ))}
      </div>
      <label className="setting-field" data-setting-id="mode" data-setting-label="明暗模式">
        <span>明暗模式</span>
        <select
          disabled={invalidColors}
          aria-label="明暗模式"
          value={appearance.mode}
          onChange={(e) => onChange({ ...appearance, mode: e.target.value as Appearance['mode'] })}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <div className="paired-palettes">
        {(['light', 'dark'] as const).map((m) => (
          <label key={m}>
            {m === 'light' ? '浅色配色' : '深色配色'}
            <select
              disabled={invalidColors}
              aria-label={m === 'light' ? '浅色配色' : '深色配色'}
              value={appearance.paletteByMode?.[m] ?? appearance.palette ?? 'ink'}
              onChange={(e) =>
                onChange({
                  ...appearance,
                  paletteByMode: {
                    ...appearance.paletteByMode,
                    [m]: e.target.value as Appearance['palette'],
                  },
                  colorThemeId: undefined,
                })
              }
            >
              {builtinPalettes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="preview-mode" role="group" aria-label="预览明暗">
        <span>正在调节{previewDark ? '深色' : '浅色'}</span>
        <button
          disabled={invalidColors}
          aria-pressed={!previewDark}
          onClick={() => onPreviewDark(false)}
        >
          预览浅色
        </button>
        <button
          disabled={invalidColors}
          aria-pressed={previewDark}
          onClick={() => onPreviewDark(true)}
        >
          预览深色
        </button>
      </div>
      <div data-setting-id="accent" data-setting-label="强调色" tabIndex={-1}>
        <ColorControl
          key={`accent-${mode}-${appearance.palette}`}
          label="强调色"
          value={colors.accent}
          onChange={(value) => setColor('accent', value)}
          onReset={() => setColor('accent')}
          onValidity={(invalid) => onValidity('accent', invalid)}
        />
        <div className="accent-swatches">
          {['#53755F', '#956A46', '#647580', '#AC6860', '#81714E'].map((value) => (
            <button
              key={value}
              aria-label={`强调色 ${value}`}
              style={{ background: value }}
              onClick={() => setColor('accent', value)}
            />
          ))}
        </div>
      </div>
      <button
        className="advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={() => {
          setAdvanced(!advancedOpen);
          if (advancedOpen) setCollapsedHighlight(revealAdvanced ?? '');
        }}
      >
        高级颜色 {advancedOpen ? '收起' : '展开'}
      </button>
      <div className="advanced-colors" hidden={!advancedOpen}>
        {(Object.keys(labels) as AppearanceColor[])
          .filter((key) => key !== 'accent')
          .map((key) => (
            <div key={key} data-setting-id={key} data-setting-label={labels[key]} tabIndex={-1}>
              <ColorControl
                key={`${key}-${mode}-${appearance.palette}`}
                label={labels[key]}
                value={resolved[key]}
                onChange={(value) => setColor(key, value)}
                onReset={() => setColor(key)}
                onValidity={(invalid) => onValidity(key, invalid)}
              />
            </div>
          ))}
      </div>
      {contrastChecks.length > 0 && (
        <p className="contrast-warning" role="status">
          {contrastChecks.map((item) => `${item.label} ${item.ratio!.toFixed(2)}:1`).join('；')}
          ，文字可能不易阅读。颜色仍保留，可自行调整。
        </p>
      )}
      <label className="setting-field" data-setting-id="density" data-setting-label="控件密度">
        <span>控件密度</span>
        <select
          aria-label="控件密度"
          value={appearance.density ?? 'standard'}
          onChange={(e) =>
            onChange({ ...appearance, density: e.target.value as Appearance['density'] })
          }
        >
          <option value="standard">标准</option>
          <option value="compact">紧凑</option>
        </select>
      </label>
      <label className="setting-field" data-setting-id="codeTheme" data-setting-label="代码配色">
        <span>代码配色</span>
        <select
          aria-label="代码配色"
          value={appearance.codeTheme ?? 'classic'}
          onChange={(e) =>
            onChange({ ...appearance, codeTheme: e.target.value as Appearance['codeTheme'] })
          }
        >
          {codeThemes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
