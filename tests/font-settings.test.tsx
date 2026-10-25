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
const saved = vi.fn(),
  removed = vi.fn();
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
