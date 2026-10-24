import { describe, expect, it } from 'vitest';
import { argumentSchemas, sessionSchema, settingsSchema } from '../electron/validation';
import { defaultSettings } from '../src/shared/defaults';

describe('desktop boundary validation', () => {
  it('limits move-history retries to one nonempty operation identity', () => {
    expect(argumentSchemas.retryMoveHistory.parse(['generated-operation'])).toEqual([
      'generated-operation',
    ]);
    for (const args of [[], [''], ['operation', 'extra'], [{ path: 'arbitrary.md' }]])
      expect(argumentSchemas.retryMoveHistory.safeParse(args).success).toBe(false);
  });
  it('limits window control to explicit modes and boolean pin values', () => {
    expect(argumentSchemas.getWindowMode.parse([])).toEqual([]);
    expect(argumentSchemas.setWindowMode.parse(['sticky'])).toEqual(['sticky']);
    expect(argumentSchemas.setWindowMode.parse(['full'])).toEqual(['full']);
    for (const args of [[], ['fullscreen'], [{ mode: 'sticky' }], ['sticky', true]]) {
      expect(argumentSchemas.setWindowMode.safeParse(args).success).toBe(false);
    }
    expect(argumentSchemas.setStickyPinned.parse([false])).toEqual([false]);
    expect(argumentSchemas.setStickyPinned.safeParse(['false']).success).toBe(false);
    expect(argumentSchemas.getWindowMode.safeParse(['extra']).success).toBe(false);
  });
  it('accepts the real default settings but rejects invalid ranges and corrupted types', () => {
    expect(settingsSchema.parse(defaultSettings)).toEqual(defaultSettings);
    expect(settingsSchema.safeParse({ ...defaultSettings, historyDays: -1 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...defaultSettings, autoSave: 'yes' }).success).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...defaultSettings,
        appearance: { ...defaultSettings.appearance, fontSize: Number.NaN },
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...defaultSettings,
        graph: { ...defaultSettings.graph, depth: Infinity },
      }).success,
    ).toBe(false);
  });
  it('rejects missing, extra and malformed IPC arguments', () => {
    expect(argumentSchemas.bootstrap.safeParse(['arbitrary']).success).toBe(false);
    expect(
      argumentSchemas.saveFile.safeParse([
        { path: '', content: '', baseContent: '', hash: '', title: '' },
      ]).success,
    ).toBe(false);
    expect(argumentSchemas.putAttachment.safeParse(['note.md', 'a.png', [0, 256]]).success).toBe(
      false,
    );
    expect(argumentSchemas.periodicNote.safeParse(['daily', '../../note']).success).toBe(false);
    expect(
      argumentSchemas.localizeImages.safeParse([
        'note.md',
        '![x](https://example.org/a)',
        ['https://example.org/a'],
      ]).success,
    ).toBe(true);
    expect(argumentSchemas.openExternal.safeParse(['javascript:alert(1)', 'extra']).success).toBe(
      false,
    );
  });
  it('keeps long file paths usable as active tab identifiers', () => {
    const id = `C:\\${'目录\\'.repeat(500)}note.md`;
    expect(
      sessionSchema.safeParse({
        activeId: id,
        tabs: [
          {
            id,
            path: id,
            title: '中文',
            content: '',
            hash: '',
            modifiedAt: 0,
            baseContent: '',
            dirty: false,
            cursor: 0,
            scrollTop: 0,
            mode: 'live',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
