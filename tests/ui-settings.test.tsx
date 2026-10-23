// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/components/SettingsPanel';
import { defaultSettings } from '../src/shared/defaults';
import { searchSettings } from '../src/ui/settingsSearch';

let host: HTMLDivElement;
let root: Root;
let saved: ReturnType<typeof vi.fn>;
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
  saved = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(structuredClone(defaultSettings));
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

it('every indexed setting leads to a rendered target with a stable name', async () => {
  const items = searchSettings('');
  expect(items).toEqual([]);
  for (const query of [
    '外观与主题',
    '字体管理',
    '编辑与文件',
    '界面与快捷键',
    '历史与恢复',
    '模板与片段',
    '日记与周期',
  ]) {
    for (const item of searchSettings(query)) {
      await type('搜索设置', item.label);
      await act(async () => result(`${item.group} · ${item.label}`)!.click());
      expect(
        host.querySelector('[data-setting-highlighted="true"]')?.getAttribute('data-setting-label'),
      ).toBe(item.target);
    }
  }
});

it('retains an unfinished exclusion line and commits parsed names only when leaving the field', async () => {
  await type('搜索设置', '索引排除目录');
  await act(async () => result('编辑与文件 · 索引排除目录')!.click());
  const before = defaultSettings.excluded.join('\n');
  const field = await type('索引排除目录', before + '\n');
  expect(field.value).toBe(before + '\n');
  expect(saved).not.toHaveBeenCalled();
  await type('索引排除目录', before + '\n新排除目录');
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
