import { describe, expect, it } from 'vitest';
import { appearanceColors } from '../src/ui/model';
import { builtinPalettes, paletteAppearance } from '../src/shared/palettes';
import { defaultAppearance } from '../src/shared/defaults';

describe('approved visual palettes', () => {
  it('switches every built-in pair correctly and preserves non-color preferences', () => {
    const custom = {
      ...defaultAppearance,
      mode: 'system' as const,
      wallpaper: 'D:/my-wallpaper.png',
      bodyFont: 'My font',
      fontSize: 23,
      codeFontSize: 18,
      editorOpacity: 0.6,
    };
    for (const palette of builtinPalettes) {
      const next = paletteAppearance(custom, palette.id);
      expect(next).toMatchObject({
        mode: 'system',
        wallpaper: custom.wallpaper,
        bodyFont: 'My font',
        fontSize: 23,
        codeFontSize: 18,
        editorOpacity: 0.6,
      });
      expect(appearanceColors(next, false)).toMatchObject({
        dark: false,
        background: palette.light.bg,
        foreground: palette.light.fg,
        accent: palette.light.accent,
      });
      expect(appearanceColors(next, true)).toMatchObject({
        dark: true,
        background: palette.dark.bg,
        foreground: palette.dark.fg,
        accent: palette.dark.accent,
      });
      expect(appearanceColors({ ...next, mode: 'light' }, true).background).toBe(palette.light.bg);
    }
  });
  it('retains custom and legacy colors', () => {
    const custom = {
      ...defaultAppearance,
      palette: undefined,
      mode: 'dark' as const,
      background: '#142536',
      foreground: '#eeeeee',
      accent: '#abcdef',
    };
    expect(appearanceColors(custom, true)).toMatchObject({
      background: '#142536',
      foreground: '#eeeeee',
      accent: '#abcdef',
    });
    expect(
      appearanceColors(
        { ...custom, background: '#f6f5f1', foreground: '#292d32', accent: '#3b756b' },
        false,
      ),
    ).toMatchObject({ background: '#1c2227', foreground: '#e1e6e9', accent: '#87b9a5' });
  });
});
