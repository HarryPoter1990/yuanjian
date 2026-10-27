import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';
import { defaultSettings } from '../src/shared/defaults';
import { appearanceColors } from '../src/ui/model';

describe('visual settings upgrade', () => {
  it('adds new shortcut defaults while preserving custom and explicitly cleared bindings', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-shortcut-upgrade-'));
    const source = JSON.stringify({ shortcuts: { save: 'Ctrl+Alt+s', find: '', custom: 'F8' } });
    await writeFile(path.join(directory, 'settings.json'), source);
    const store = new NoteStore(directory);
    try {
      await store.initialize();
      expect(store.getSettings().shortcuts).toMatchObject({
        save: 'Ctrl+Alt+s',
        find: '',
        custom: 'F8',
        quickOpen: 'Ctrl+p',
        replace: 'Ctrl+h',
        reopen: 'Ctrl+Shift+t',
        back: 'Alt+ArrowLeft',
        forward: 'Alt+ArrowRight',
      });
      expect(await readFile(path.join(directory, 'settings.json'), 'utf8')).toBe(source);
    } finally {
      await store.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('preserves old colors, fonts, widths, visibility and stored themes without adopting the new palette', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-upgrade-'));
    const legacy = structuredClone(defaultSettings);
    delete legacy.appearance.palette;
    delete legacy.appearance.codeTheme;
    legacy.appearance.background = '#f6f5f1';
    legacy.appearance.foreground = '#292d32';
    legacy.appearance.accent = '#3b756b';
    legacy.appearance.fontSize = 21;
    legacy.appearance.bodyFont = 'Custom font';
    legacy.leftWidth = 318;
    legacy.toolbarVisible = false;
    legacy.themes = [{ id: 'my-theme', name: '我的外观', appearance: { ...legacy.appearance } }];
    const source = JSON.stringify(legacy);
    await writeFile(path.join(directory, 'settings.json'), source);
    const store = new NoteStore(directory);
    try {
      await store.initialize();
      const actual = store.getSettings();
      expect(actual.appearance.palette).toBeUndefined();
      expect(actual.appearance.codeTheme).toBe('classic');
      expect(actual.appearance).toMatchObject(legacy.appearance);
      expect(actual).toMatchObject({
        leftWidth: 318,
        toolbarVisible: false,
        themes: legacy.themes,
      });
      expect(appearanceColors(actual.appearance, false).background).toBe('#f6f5f1');
      expect(await readFile(path.join(directory, 'settings.json'), 'utf8')).toBe(source);
      await store.saveSettings(actual);
      expect(
        JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')).appearance,
      ).not.toHaveProperty('palette');
    } finally {
      await store.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('uses neutral code and workspace defaults only for a fresh profile', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-new-visual-'));
    const store = new NoteStore(directory);
    try {
      await store.initialize();
      expect(store.getSettings().appearance).toMatchObject({
        palette: 'neutral',
        codeTheme: 'neutral',
      });
    } finally {
      await store.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
