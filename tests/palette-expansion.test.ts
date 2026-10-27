import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtinPalettes, paletteAppearance } from '../src/shared/palettes';
import { defaultAppearance } from '../src/shared/defaults';
import { appearanceColors } from '../src/ui/model';
import { colorThemeSnapshot, contrastRatio, syntaxColors } from '../src/shared/appearance';
import { settingsSchema } from '../electron/validation';
import { NoteStore } from '../electron/storage/store';

const additions = ['slate', 'amber', 'rose', 'iris'] as const;
describe('the four additional writing palettes', () => {
  it('keeps released palettes byte-for-byte while exposing four distinct new names', () => {
    expect(builtinPalettes.map((palette) => palette.id)).toEqual([
      'neutral',
      'ink',
      'moss',
      'paper',
      ...additions,
    ]);
    // Fingerprint of the published 0.9.1 palette definitions, before the expansion.
    expect(
      createHash('sha256')
        .update(JSON.stringify(builtinPalettes.slice(0, 4)))
        .digest('hex'),
    ).toBe('6c22195a25a89596ceeae0e223de424c692ac6066be6dab0721eee00c515b5bb');
    expect(builtinPalettes.slice(4).map((palette) => palette.name)).toEqual([
      '雾蓝石板',
      '麦纸琥珀',
      '雾玫瑰',
      '鸢紫',
    ]);
  });
  it.each(additions)(
    '%s has the reviewed ink, control boundaries and readable paired colors',
    (id) => {
      const chosen = paletteAppearance({ ...defaultAppearance, codeTheme: 'calm' }, id);
      for (const dark of [false, true]) {
        const colors = appearanceColors({ ...chosen, mode: 'system' }, dark);
        expect(colors.refined).toBe(true);
        expect(colors.quoteBackground).toBe('transparent');
        const textPairs = [
          [colors.foreground, colors.background],
          [colors.muted, colors.sidebar],
          [colors.foreground, colors.selected],
          [colors.muted, colors.selected],
          [colors.accentText, colors.accent],
          [colors.accent, colors.background],
        ];
        for (const [fg, bg] of textPairs) expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.controlBorder!, colors.background)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(colors.controlBorder!, colors.sidebar)).toBeGreaterThanOrEqual(3);
        expect(chosen.codeTheme).toBe('calm');
        expect(syntaxColors(chosen.codeTheme, dark)).toEqual(syntaxColors('calm', dark));
        if (id === 'iris') expect(colors.pinAccent).toBe(dark ? '#C6B17E' : '#876D38');
        else expect(colors.pinAccent).toBeUndefined();
      }
    },
  );
  it('uses each mode’s selected palette and removes refined styling on return to a released palette', () => {
    const paired = {
      ...paletteAppearance(defaultAppearance, 'iris'),
      mode: 'system' as const,
      paletteByMode: { light: 'paper' as const, dark: 'slate' as const },
    };
    expect(appearanceColors(paired, false)).toMatchObject({
      refined: false,
      quoteBackground: '#F6F2EB',
    });
    expect(appearanceColors(paired, true)).toMatchObject({
      refined: true,
      background: '#252A33',
      pinAccent: undefined,
    });
    const custom = {
      ...paletteAppearance(defaultAppearance, 'iris'),
      paletteOverrides: { light: { accent: '#112233', border: '#445566' } },
    };
    expect(appearanceColors(custom, false)).toMatchObject({
      accent: '#112233',
      controlBorder: '#445566',
    });
  });
  it('round-trips all new IDs, mode pairs and saved schemes through validation and a storage restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-eight-palettes-'));
    let store = new NoteStore(directory);
    try {
      await store.initialize();
      for (const id of additions) {
        const appearance = {
          ...paletteAppearance(store.getSettings().appearance, id),
          paletteByMode: { light: id, dark: 'ink' as const },
          bodyFont: 'Chosen font',
          codeTheme: 'calm' as const,
        };
        const next = settingsSchema.parse({
          ...store.getSettings(),
          appearance,
          themes: [{ id: 'saved', name: 'Saved scheme', appearance }],
          colorThemes: [
            { id: 'color', name: 'Saved colors', appearance: colorThemeSnapshot(appearance) },
          ],
        });
        await store.saveSettings(next);
        await store.dispose();
        store = new NoteStore(directory);
        await store.initialize();
        expect(store.getSettings().appearance).toMatchObject({
          palette: id,
          paletteByMode: { light: id, dark: 'ink' },
          bodyFont: 'Chosen font',
          codeTheme: 'calm',
        });
        expect(store.getSettings().themes[0].appearance.palette).toBe(id);
        expect(store.getSettings().colorThemes?.[0].appearance.palette).toBe(id);
      }
    } finally {
      await store.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
