import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPanel } from '../../src/components/SettingsPanel';
import { defaultSettings } from '../../src/shared/defaults';
import { appearanceColors } from '../../src/ui/model';

const initialFonts = [
  ...['Noto Sans SC Variable', 'Noto Serif SC Variable', 'Inter Variable', 'JetBrains Mono'].map(
    (name, i) => ({ id: `builtin-${i}`, name, source: 'bundled' }),
  ),
  { id: 'owned-a', name: 'Imported Font', source: 'imported', path: 'D:/generated/a.ttf' },
  { id: 'owned-b', name: 'Imported Font', source: 'downloaded', path: 'D:/generated/b.ttf' },
  { id: 'system-inter', name: 'Inter Variable', source: 'system' },
  ...Array.from({ length: 350 }, (_, index) => ({
    id: `system-${index}`,
    name: `System Font ${String(index).padStart(3, '0')}`,
    source: 'system',
  })),
];
const fixture = { saved: [], removed: [], errors: [], setDark: null, settings: null };
window.fontFixture = fixture;
window.notes = {
  getFontCatalog: async () => [],
  historyStats: async () => ({ count: 0, textBytes: 0, imageBytes: 0, totalBytes: 0 }),
  getFonts: async () => initialFonts.filter((font) => !fixture.removed.includes(font.id)),
  removeFont: async (id) => {
    fixture.removed.push(id);
  },
};
function Fixture() {
  const [settings, setSettings] = useState(structuredClone(defaultSettings));
  const [fonts, setFonts] = useState(initialFonts);
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  fixture.settings = settings;
  fixture.setDark = setDark;
  fixture.setSettings = setSettings;
  const colors = appearanceColors({ ...settings.appearance, mode: dark ? 'dark' : 'light' }, false);
  const style = Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [`--${key}`, value]),
  );
  return (
    <div
      className="app"
      data-theme={dark ? 'dark' : 'light'}
      style={{ ...style, '--ui-font': 'sans-serif' }}
    >
      <button onClick={() => setOpen(true)}>打开字体设置</button>
      {open && (
        <SettingsPanel
          settings={settings}
          fonts={fonts}
          onFonts={setFonts}
          dataDirectory="isolated-fixture"
          version="font-fixture"
          onChange={(value) => {
            fixture.saved.push(value);
            setSettings(value);
          }}
          onClose={() => setOpen(false)}
          onError={(message) => {
            fixture.errors.push(message);
          }}
          saveState="设置已保存"
        />
      )}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
