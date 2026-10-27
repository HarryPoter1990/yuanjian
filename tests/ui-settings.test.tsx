// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/components/SettingsPanel';
import { defaultSettings } from '../src/shared/defaults';
import { searchSettings } from '../src/ui/settingsSearch';
import type { Settings } from '../src/shared/types';

let host: HTMLDivElement;
let root: Root;
let currentSettings: Settings;
let replaceSettings: (settings: Settings) => void;
const saved = vi.fn<(settings: Settings) => void>();
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.matchMedia = () => ({ matches: false }) as MediaQueryList;
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.notes = {
    getFontCatalog: vi.fn(async () => []),
    historyStats: vi.fn(async () => ({ count: 0, textBytes: 0, imageBytes: 0, totalBytes: 0 })),
  } as unknown as typeof window.notes;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  saved.mockClear();
  function Harness() {
    const [settings, setSettings] = useState(structuredClone(defaultSettings));
    currentSettings = settings;
    replaceSettings = setSettings;
    return (
      <SettingsPanel
        settings={settings}
        fonts={[]}
        dataDirectory="isolated"
        version="test"
        onChange={(next) => {
          saved(next);
          setSettings(next);
        }}
        onFonts={() => {}}
        onClose={() => {}}
        onError={(error) => {
          throw Error(error);
        }}
        saveState="设置已保存"
      />
    );
  }
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function type(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  );
  if (!field) throw Error(`missing field ${label}`);
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}
function result(label: string) {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

it('searches concrete labels and descriptions, then focuses and highlights the matching control', async () => {
  await type('搜索设置', '自动保存');
  expect(host.textContent).toContain('未命名草稿保留在会话中');
  await act(async () => result('编辑与文件 · 自动保存')!.click());
  const field = host.querySelector<HTMLElement>('[data-setting-label="自动保存"]')!;
  expect(field.dataset.settingHighlighted).toBe('true');
  expect(document.activeElement).toBe(field);
  expect(field.querySelector('[role="switch"]')).not.toBeNull();
  expect(saved).not.toHaveBeenCalled();
  await type('搜索设置', '单独 文字大小');
  expect(result('编辑与文件 · 代码字号')).not.toBeNull();
});

it('finds every actually displayed appearance field by its visible label and locates that exact field', async () => {
  await act(async () =>
    replaceSettings({
      ...currentSettings,
      appearance: { ...currentSettings.appearance, wallpaper: 'generated-fixture.png' },
    }),
  );
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('.settings-nav > button')]
      .find((button) => button.textContent?.includes('壁纸'))!
      .click(),
  );
  const labels = [...host.querySelectorAll<HTMLElement>('[data-setting-label]')]
    .filter((field) => !field.closest('[hidden]'))
    .map((field) => field.dataset.settingLabel!);
  expect(labels).toContain('壁纸透明度');
  expect(labels).toContain('模糊');
  for (const label of labels) {
    await type('搜索设置', label);
    const target = result(`壁纸 · ${label}`);
    expect(target, `visible setting ${label} must be searchable`).not.toBeNull();
    await act(async () => target!.click());
    expect(
      host.querySelector('[data-setting-highlighted="true"]')?.getAttribute('data-setting-label'),
    ).toBe(label);
  }
});

it('explains the prerequisite for a wallpaper control when no image has been selected', async () => {
  await type('搜索设置', '壁纸位置');
  expect(host.textContent).toContain('先选择壁纸');
  await act(async () => result('壁纸 · 壁纸位置')!.click());
  expect(
    host.querySelector('[data-setting-highlighted="true"]')?.getAttribute('data-setting-label'),
  ).toBe('本地图片');
});

const categories = [
  '外观与主题',
  '字体管理',
  '壁纸',
  '编辑与文件',
  '界面与快捷键',
  '历史与恢复',
  '模板与片段',
  '日记与周期',
];
it.each(categories)('every indexed setting in %s leads to its rendered target', async (query) => {
  expect(searchSettings('')).toEqual([]);
  const entries = searchSettings(query, currentSettings);
  expect(entries.length).toBeGreaterThan(0);
  for (const item of entries) {
    await type('搜索设置', item.label);
    await act(async () => result(`${item.group} · ${item.label}`)!.click());
    expect(
      host.querySelector('[data-setting-highlighted="true"]')?.getAttribute('data-setting-id'),
    ).toBe(item.target);
  }
});
it.each(categories)(
  'indexes every displayed control in %s including shortcut and snippet fields',
  async (group) => {
    const category = [...host.querySelectorAll<HTMLButtonElement>('.settings-nav > button')].find(
      (button) => button.textContent?.includes(group),
    )!;
    await act(async () => category.click());
    const fields = [...host.querySelectorAll<HTMLElement>('.settings-content [data-setting-id]')]
      .filter((field) => !field.closest('[hidden]'))
      .map((field) => ({ id: field.dataset.settingId!, label: field.dataset.settingLabel! }));
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      await type('搜索设置', field.label);
      const entry = result(`${group} · ${field.label}`);
      expect(entry, `${group}/${field.label} must be in search`).not.toBeNull();
      await act(async () => entry!.click());
      expect(
        host.querySelector('[data-setting-highlighted="true"]')?.getAttribute('data-setting-id'),
      ).toBe(field.id);
    }
  },
);

it('retains unfinished exclusion lines while making directory edits available to the existing save lifecycle', async () => {
  await type('搜索设置', '索引排除目录');
  await act(async () => result('编辑与文件 · 索引排除目录')!.click());
  const before = defaultSettings.excluded.join('\n');
  const field = await type('索引排除目录', before + '\n');
  expect(field.value).toBe(before + '\n');
  expect(saved).not.toHaveBeenCalled();
  await type('索引排除目录', before + '\n新排除目录');
  expect(saved).toHaveBeenLastCalledWith(
    expect.objectContaining({ excluded: [...defaultSettings.excluded, '新排除目录'] }),
  );
  await act(async () => {
    field.focus();
    host.querySelector<HTMLInputElement>('[aria-label="搜索设置"]')!.focus();
  });
  expect(saved).toHaveBeenLastCalledWith(
    expect.objectContaining({ excluded: [...defaultSettings.excluded, '新排除目录'] }),
  );
});
it('names shortcut inputs in Chinese and exposes a conflict with a per-action reset', async () => {
  await type('搜索设置', '应用快捷键');
  await act(async () => result('界面与快捷键 · 应用快捷键')!.click());
  const field = await type('保存快捷键', 'Ctrl+n');
  expect(host.textContent).toContain('与“新建”使用相同组合键');
  await act(async () => field.focus());
  expect(host.textContent).toContain('正在录制');
  await act(async () => result('恢复保存默认快捷键')!.click());
  expect(field.value).toBe(defaultSettings.shortcuts.save);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('retains the exclusion draft when a settings reply only clones the same saved values', async () => {
  await type('搜索设置', '索引排除目录');
  await act(async () => result('编辑与文件 · 索引排除目录')!.click());
  const draft = defaultSettings.excluded.join('\n') + '\n正在输入';
  const field = await type('索引排除目录', draft);
  await act(async () => replaceSettings(structuredClone(currentSettings)));
  expect(field.value).toBe(draft);
});
