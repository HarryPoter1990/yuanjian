// @vitest-environment jsdom
import { act, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { SettingsPanel } from '../src/components/SettingsPanel';
import { defaultSettings } from '../src/shared/defaults';
import type { Appearance, Settings } from '../src/shared/types';
let root: Root,
  host: HTMLDivElement,
  current: Settings,
  preview: Appearance | null,
  dark: boolean | null | undefined;
const apply = vi.fn(async (_value: Appearance) => {});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.matchMedia = () => ({ matches: false }) as MediaQueryList;
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.notes = {
    getFontCatalog: async () => [],
    chooseWallpaper: async () => 'generated-wallpaper.png',
  } as unknown as typeof window.notes;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  apply.mockReset();
  apply.mockResolvedValue();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  function Harness() {
    const [settings, setSettings] = useState(structuredClone(defaultSettings));
    const [open, setOpen] = useState(true);
    current = settings;
    const onPreview = useCallback((value: Appearance | null, mode?: boolean | null) => {
      preview = value;
      dark = mode;
    }, []);
    return open ? (
      <SettingsPanel
        settings={settings}
        fonts={[]}
        dataDirectory="generated"
        version="test"
        onChange={setSettings}
        onPreview={onPreview}
        onApplyAppearance={async (value, removals) => {
          await apply(value);
          setSettings((s) => ({
            ...s,
            appearance: structuredClone(value),
            themes: s.themes.filter((item) => !removals?.schemes.includes(item.id)),
            colorThemes: (s.colorThemes ?? []).filter(
              (item) => !removals?.colors.includes(item.id),
            ),
          }));
        }}
        onFonts={() => {}}
        onClose={() => setOpen(false)}
        onError={() => {}}
        saveState="设置已保存"
      />
    ) : null;
  }
  await act(async () => root.render(<Harness />));
}
function button(name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function type(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('keeps theme, typography, and wallpaper preview out of committed settings, even during a general settings change and close', async () => {
  await mount();
  const original = structuredClone(current.appearance);
  await type('强调色 HEX', '#987654');
  await click('选择图片');
  expect(preview!.wallpaper).toBe('generated-wallpaper.png');
  expect(current.appearance).toEqual(original);
  await click('编辑与文件');
  const toggle = host.querySelector<HTMLInputElement>('[aria-label="自动保存"]')!;
  await act(async () => toggle.click());
  expect(current.autoSave).not.toBe(defaultSettings.autoSave);
  expect(current.appearance).toEqual(original);
  const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!;
  await act(async () => close.click());
  expect(preview).toBeNull();
  expect(current.appearance).toEqual(original);
  expect(apply).not.toHaveBeenCalled();
});
it('failed apply retains preview and retries explicitly, then cancel restores the newly applied baseline', async () => {
  await mount();
  const original = structuredClone(current.appearance);
  await type('强调色 HEX', '#987654');
  apply.mockRejectedValueOnce(Error('generated write failure'));
  await click('应用外观');
  expect(current.appearance).toEqual(original);
  expect(preview!.paletteOverrides!.light!.accent).toBe('#987654');
  expect(host.textContent).toContain('外观未应用');
  await click('应用外观');
  expect(current.appearance.paletteOverrides!.light!.accent).toBe('#987654');
  await type('强调色 HEX', '#445566');
  await click('取消预览');
  expect(preview).toEqual(current.appearance);
  expect(apply).toHaveBeenCalledTimes(2);
});
it('saving a color theme preserves the committed appearance; follow-system preview does not overwrite mode', async () => {
  await mount();
  await type('强调色 HEX', '#987654');
  await click('预览深色');
  expect(dark).toBe(true);
  expect(preview!.mode).toBe(defaultSettings.appearance.mode);
  await click('保存为新方案');
  expect(current.colorThemes).toHaveLength(1);
  expect(current.appearance).toEqual(defaultSettings.appearance);
  expect(apply).not.toHaveBeenCalled();
  await click('取消预览');
  expect(dark).toBeNull();
  expect(preview).toEqual(defaultSettings.appearance);
});
it('invalid advanced color cannot be silently ignored by applying another field', async () => {
  await mount();
  await click('高级颜色 展开');
  await type('文字色 HEX', '#invalid');
  expect(button('应用外观').disabled).toBe(true);
  await type('强调色 HEX', '#987654');
  expect(button('应用外观').disabled).toBe(true);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="还原文字色"]')!.click(),
  );
  expect(button('应用外观').disabled).toBe(false);
});

it('guards an unfinished scheme name when closing settings', async () => {
  await mount();
  await type('方案名称', '未提交的主题');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!.click(),
  );
  expect(host.textContent).toContain('继续编辑');
  expect(preview).not.toBeNull();
});

it('retains invalid input when advanced colors collapse or categories change', async () => {
  await mount();
  await click('高级颜色 展开');
  await type('文字色 HEX', '#invalid');
  await click('高级颜色 收起');
  expect(button('应用外观').disabled).toBe(true);
  await click('字体管理');
  await click('外观与主题');
  expect(button('应用外观').disabled).toBe(true);
  await click('高级颜色 展开');
  expect(host.querySelector<HTMLInputElement>('[aria-label="文字色 HEX"]')!.value).toBe('#invalid');
});
it('keeps the selected full scheme while changing typography in another category', async () => {
  await mount();
  await click('完整外观方案');
  await click('保存为新方案');
  const first = current.themes[0];
  await act(async () =>
    host.querySelector<HTMLButtonElement>(`[aria-label="预览 ${first.name}"]`)!.click(),
  );
  await click('字体管理');
  await click('外观与主题');
  expect(button('更新当前方案 / 重命名').disabled).toBe(false);
  expect(host.querySelector<HTMLInputElement>('[aria-label="方案名称"]')!.value).toBe(first.name);
  const size = host.querySelector<HTMLInputElement>('[aria-label="正文字号"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(size, '22');
    size.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('字体管理');
  await click('外观与主题');
  await click('更新当前方案 / 重命名');
  expect(current.themes).toHaveLength(1);
  expect(current.themes[0].appearance.fontSize).toBe(22);
  expect(current.appearance.fontSize).toBe(defaultSettings.appearance.fontSize);
});

it('stages deletion of the applied scheme with its fallback, cancelling restores both and apply commits both', async () => {
  await mount();
  await click('完整外观方案');
  await click('保存为新方案');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="预览 我的外观"]')!.click(),
  );
  await click('应用外观');
  const original = structuredClone(current.appearance);
  expect(original.schemeId).toBe(current.themes[0].id);
  const remove = () => host.querySelector<HTMLButtonElement>('[aria-label="删除 我的外观"]')!;
  await act(async () => remove().click());
  expect(current.themes).toHaveLength(1);
  expect(preview!.schemeId).toBeUndefined();
  await click('取消预览');
  expect(current.themes).toHaveLength(1);
  expect(preview).toEqual(original);
  await act(async () => remove().click());
  apply.mockRejectedValueOnce(Error('generated failure'));
  await click('应用外观');
  expect(current.themes).toHaveLength(1);
  expect(current.appearance).toEqual(original);
  await click('保存为新方案');
  expect(current.themes).toHaveLength(2);
  expect(current.themes.some((item) => item.id === original.schemeId)).toBe(true);
  await click('应用外观');
  expect(current.themes).toHaveLength(1);
  expect(current.appearance.schemeId).toBeUndefined();
  expect(current.appearance.bodyFont).toBe(original.bodyFont);
  expect(current.appearance.wallpaper).toBe(original.wallpaper);
});
