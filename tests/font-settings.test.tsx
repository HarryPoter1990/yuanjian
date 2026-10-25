// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/components/SettingsPanel';
import { defaultSettings } from '../src/shared/defaults';
import type { FontEntry, Settings } from '../src/shared/types';

const fonts: FontEntry[] = [
  ...['Noto Sans SC Variable', 'Noto Serif SC Variable', 'Inter Variable', 'JetBrains Mono'].map(
    (name, index) => ({ id: `bundled-${index}`, name, source: 'bundled' as const }),
  ),
  { id: 'owned-a', name: 'My Font', source: 'imported', path: 'D:/generated/a.ttf' },
  { id: 'owned-b', name: 'My Font', source: 'downloaded', path: 'D:/generated/b.ttf' },
  { id: 'system-inter', name: 'Inter Variable', source: 'system' },
  { id: 'system-a', name: 'System Alpha', source: 'system' },
  { id: 'system-b', name: 'System Beta', source: 'system' },
];
let host: HTMLDivElement, root: Root, current: Settings;
let replaceSettings: (settings: Settings) => void;
const saved = vi.fn(),
  removed = vi.fn();
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.matchMedia = () => ({ matches: false }) as MediaQueryList;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this instanceof HTMLDialogElement) return new DOMRect(0, 0, 1000, 800);
    if (this.classList.contains('modal-header')) return new DOMRect(0, 0, 1000, 60);
    return new DOMRect(400, 180, 200, 32);
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.notes = {
    getFontCatalog: async () => [],
    historyStats: async () => ({ count: 0, textBytes: 0, imageBytes: 0, totalBytes: 0 }),
    removeFont: removed,
    getFonts: async () => fonts.filter((font) => font.id !== removed.mock.lastCall?.[0]),
  } as unknown as typeof window.notes;
  saved.mockClear();
  removed.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    const [settings, setSettings] = useState(structuredClone(defaultSettings));
    replaceSettings = setSettings;
    const [available, setAvailable] = useState(fonts);
    current = settings;
    return (
      <SettingsPanel
        settings={settings}
        fonts={available}
        dataDirectory="generated-only"
        version="fixture"
        saveState="设置已保存"
        onFonts={setAvailable}
        onChange={(value) => {
          saved(value);
          setSettings(value);
        }}
        onClose={() => {}}
        onError={(message) => {
          throw Error(message);
        }}
      />
    );
  }
  await act(async () => root.render(<Harness />));
  const navigation = [...host.querySelectorAll<HTMLButtonElement>('.settings-nav button')].find(
    (button) => button.textContent?.includes('字体管理'),
  )!;
  await act(async () => navigation.click());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.getAttribute('aria-label') === label || element.textContent === label,
  )!;
async function type(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
it('shows bundled and managed files while keeping system previews collapsed by default', () => {
  expect(host.querySelectorAll('.font-row')).toHaveLength(6);
  expect(
    [...host.querySelectorAll('.font-row')].map((row) => row.textContent).join(' '),
  ).not.toContain('System Alpha');
  expect(button('系统字体').getAttribute('aria-expanded')).toBe('false');
  expect(current).toEqual(defaultSettings);
  expect(saved).not.toHaveBeenCalled();
});
it('searches all sources while collapsed, then restores the previous system disclosure state', async () => {
  await type('搜索字体', 'system alpha');
  expect(host.querySelectorAll('.font-row')).toHaveLength(1);
  expect(host.querySelector('.font-row')?.textContent).toContain('System Alpha');
  await type('搜索字体', '');
  expect(host.querySelectorAll('.font-row')).toHaveLength(6);
  await act(async () => button('系统字体').click());
  expect(host.querySelectorAll('.font-row')).toHaveLength(9);
  await type('搜索字体', 'missing font');
  expect(host.textContent).toContain('没有匹配的字体');
  await type('搜索字体', '');
  expect(button('系统字体').getAttribute('aria-expanded')).toBe('true');
  expect(saved).not.toHaveBeenCalled();
});
it('keeps same-name managed files separately removable without removing the other file', async () => {
  const entry = [...host.querySelectorAll('.font-row')].find((row) =>
    row.textContent?.includes('My Font'),
  )!;
  await act(async () => entry.querySelector<HTMLButtonElement>('button')!.click());
  expect(removed).toHaveBeenCalledExactlyOnceWith('owned-a');
  const remaining = [...host.querySelectorAll('.font-row')].filter((row) =>
    row.textContent?.includes('My Font'),
  );
  expect(remaining).toHaveLength(1);
  expect(remaining[0].textContent).toContain('已下载');
  expect(saved).not.toHaveBeenCalled();
});

const popup = () => host.querySelector<HTMLElement>('[aria-label="选择正文字体"]')!;
async function key(input: HTMLElement, value: string, composing = false) {
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
        isComposing: composing,
      }),
    ),
  );
}
it('provides four search pickers, merges exact names and marks all sources without changing settings', async () => {
  for (const label of ['界面字体', '正文字体', '标题字体', '代码字体'])
    expect(button(label)).toBeInstanceOf(HTMLButtonElement);
  await act(async () => button('正文字体').click());
  const choices = [...popup().querySelectorAll('[role="option"]')];
  expect(choices.filter((font) => font.textContent?.includes('Inter Variable'))).toHaveLength(1);
  expect(
    choices.find((font) => font.textContent?.includes('Inter Variable'))?.textContent,
  ).toContain('内置 / 系统');
  expect(popup().textContent).not.toContain('System Alpha');
  expect(popup().querySelector('[aria-selected="true"]')?.textContent).toContain(
    current.appearance.bodyFont,
  );
  expect(saved).not.toHaveBeenCalled();
});
it('finds a collapsed system font and applies keyboard selection only to the chosen text role', async () => {
  const before = structuredClone(current.appearance);
  await act(async () => button('正文字体').click());
  const input = await type('搜索正文字体', 'system alpha');
  expect(popup().querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(saved).not.toHaveBeenCalled();
  await key(input, 'Enter');
  expect(current.appearance).toEqual({ ...before, bodyFont: 'System Alpha' });
  expect(popup()).toBeNull();
  expect(document.activeElement).toBe(button('正文字体'));
  await act(async () => button('正文字体').click());
  expect(popup().querySelector('[role="group"][aria-label="当前使用"]')?.textContent).toContain(
    'System Alpha',
  );
});
it('cancels picker navigation with Escape while keeping the settings dialog and font unchanged', async () => {
  await act(async () => button('正文字体').click());
  const input = await type('搜索正文字体', 'not-found');
  expect(popup().textContent).toContain('没有匹配的字体');
  await key(input, 'Enter');
  expect(saved).not.toHaveBeenCalled();
  await key(input, 'Escape');
  expect(popup()).toBeNull();
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(document.activeElement).toBe(button('正文字体'));
});
it('does not treat composing Enter or Escape as a font selection or picker dismissal', async () => {
  await act(async () => button('正文字体').click());
  const input = await type('搜索正文字体', 'System Alpha');
  await key(input, 'Enter', true);
  expect(saved).not.toHaveBeenCalled();
  await key(input, 'Escape', true);
  expect(popup()).not.toBeNull();
  expect(saved).not.toHaveBeenCalled();
});
it('preserves a configured font absent from the current list and keeps it available as the current choice', async () => {
  await act(async () =>
    replaceSettings({
      ...current,
      appearance: { ...current.appearance, bodyFont: 'Saved Missing Font' },
    }),
  );
  await act(async () => button('正文字体').click());
  expect(popup().querySelector('[aria-selected="true"]')?.textContent).toContain(
    'Saved Missing Font',
  );
  expect(popup().textContent).toContain('当前设置 · 未在列表中');
  await key(host.querySelector<HTMLInputElement>('input[aria-label="搜索正文字体"]')!, 'Escape');
  expect(current.appearance.bodyFont).toBe('Saved Missing Font');
  expect(saved).not.toHaveBeenCalled();
});
