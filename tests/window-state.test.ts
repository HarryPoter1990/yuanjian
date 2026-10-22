import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  applyWindowTheme,
  captureWindowState,
  restoreWindowBounds,
  restoreWindowState,
  WindowStateStore,
} from '../electron/window-state';
import { argumentSchemas, settingsSchema } from '../electron/validation';
import { defaultSettings } from '../src/shared/defaults';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const sandboxes: string[] = [];
afterEach(async () => {
  for (const directory of sandboxes.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('native window state', () => {
  it('corrects measured native DPI offsets without feeding them into later launches', () => {
    const saved = { x: 134, y: 40, width: 1121, height: 761 };
    for (let launch = 0; launch < 3; launch++) {
      let actual = { ...saved, width: saved.width + 4, height: saved.height + 2 };
      const target = {
        getNormalBounds: () => ({ ...actual }),
        setBounds: (requested: typeof saved) => {
          actual = { ...requested, width: requested.width + 1, height: requested.height + 1 };
        },
      };
      expect(restoreWindowBounds(target, saved)).toEqual(saved);
      expect(actual).toEqual(saved);
    }
  });
  it('preserves the chosen rectangle on state transitions and records a later normal resize', () => {
    const chosen = { x: 134, y: 40, width: 1121, height: 761 };
    const target = {
      getNormalBounds: () => ({ ...chosen, width: 1125, height: 763 }),
      isMaximized: () => true,
      isMinimized: () => false,
    };
    const maximized = captureWindowState(target, { bounds: chosen, maximized: false }, false);
    expect(maximized).toEqual({ bounds: chosen, maximized: true });
    expect(captureWindowState({ ...target, isMinimized: () => true }, maximized, false)).toEqual(
      maximized,
    );
    expect(
      captureWindowState(
        {
          ...target,
          isMaximized: () => false,
          getNormalBounds: () => ({ ...chosen, width: 1300 }),
        },
        { bounds: chosen, maximized: false },
        true,
      ),
    ).toEqual({ bounds: { ...chosen, width: 1300 }, maximized: false });
  });
  it('bounds calibration stops if the native platform cannot represent the requested rectangle', () => {
    const desired = { x: 30, y: 40, width: 600, height: 480 };
    const setBounds = vi.fn();
    expect(
      restoreWindowBounds(
        { getNormalBounds: () => ({ ...desired, width: 601 }), setBounds },
        desired,
      ),
    ).toEqual({ ...desired, width: 601 });
    expect(setBounds).toHaveBeenCalledTimes(4);
    expect(desired).toEqual({ x: 30, y: 40, width: 600, height: 480 });
  });
  it('keeps a valid normal rectangle on a monitor to the left of the primary display', () => {
    const saved = { bounds: { x: -1800, y: 30, width: 1200, height: 800 }, maximized: false };
    expect(restoreWindowState(saved, [workArea, { ...workArea, x: -1920 }])).toEqual(saved);
  });
  it('fits removed-display and oversized rectangles entirely into the remaining work area', () => {
    const restored = restoreWindowState(
      { bounds: { x: 3000, y: -900, width: 2560, height: 1600 }, maximized: true },
      [workArea],
    );
    expect(restored).toEqual({ bounds: workArea, maximized: true });
    const clipped = restoreWindowState(
      { bounds: { x: 1800, y: 100, width: 800, height: 700 }, maximized: false },
      [workArea],
    );
    expect(clipped.bounds).toEqual({ x: 1120, y: 100, width: 800, height: 700 });
  });
  it('rejects corrupt state and accommodates a small work area without restoring offscreen', () => {
    expect(
      restoreWindowState({ bounds: { x: Infinity, y: 0, width: -1, height: 0 }, maximized: true }, [
        workArea,
      ]),
    ).toEqual({ bounds: { x: 240, y: 50, width: 1440, height: 940 }, maximized: false });
    expect(restoreWindowState(null, [{ x: 20, y: 30, width: 500, height: 400 }])).toEqual({
      bounds: { x: 20, y: 30, width: 500, height: 400 },
      maximized: false,
    });
  });
  it('records normal bounds while maximized and does not lose maximization by minimizing', () => {
    const normal = { x: 80, y: 50, width: 1200, height: 800 };
    const previous = { bounds: normal, maximized: true };
    expect(
      captureWindowState({
        getNormalBounds: () => normal,
        isMaximized: () => true,
        isMinimized: () => false,
      }),
    ).toEqual(previous);
    expect(
      captureWindowState(
        { getNormalBounds: () => normal, isMaximized: () => false, isMinimized: () => true },
        previous,
      ),
    ).toEqual(previous);
  });
  it('persists an independent JSON state atomically and survives invalid saved JSON', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-window-state-'));
    sandboxes.push(directory);
    const store = new WindowStateStore(directory);
    const saved = { bounds: { x: 30, y: 40, width: 700, height: 600 }, maximized: true };
    await store.save(saved);
    expect(await store.load([workArea])).toEqual(saved);
    expect(JSON.parse(await readFile(path.join(directory, 'window-state.json'), 'utf8'))).toEqual(
      saved,
    );
    expect(await readdir(directory)).toEqual(['window-state.json']);
    await writeFile(path.join(directory, 'window-state.json'), '{broken');
    expect((await store.load([workArea])).maximized).toBe(false);
  });
  it('persists compact bounds and pin preference separately without replacing full bounds', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-sticky-state-'));
    sandboxes.push(directory);
    const store = new WindowStateStore(directory);
    const saved = {
      bounds: { x: 30, y: 40, width: 1200, height: 800 },
      maximized: true,
      sticky: { bounds: { x: 1480, y: 24, width: 420, height: 640 }, pinned: false },
    };
    await store.save(saved);
    expect(await store.load([workArea])).toEqual(saved);
    const fitted = await store.load([{ x: 0, y: 0, width: 800, height: 600 }]);
    expect(fitted.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(fitted.sticky).toEqual({
      bounds: { x: 380, y: 0, width: 420, height: 600 },
      pinned: false,
    });
  });
});

describe('native title bar theme boundary', () => {
  it('strictly accepts a pair of opaque hex colors, rejecting scripts, alpha and unknown fields', () => {
    expect(
      argumentSchemas.setWindowTheme.safeParse([{ background: '#fafafa', foreground: '#202020' }])
        .success,
    ).toBe(true);
    for (const theme of [
      { background: 'red', foreground: '#202020' },
      { background: '#11223344', foreground: '#202020' },
      { background: '#ffffff', foreground: 'url(javascript:1)' },
      { background: '#ffffff', foreground: '#202020', windowId: 42 },
    ])
      expect(argumentSchemas.setWindowTheme.safeParse([theme]).success).toBe(false);
  });
  it('updates native Windows controls and border without exposing minimize/maximize replacements', () => {
    const target = {
      setBackgroundColor: vi.fn(),
      setTitleBarOverlay: vi.fn(),
      setAccentColor: vi.fn(),
    };
    applyWindowTheme(target, { background: '#1c2020', foreground: '#eeeeee' }, 'win32');
    expect(target.setBackgroundColor).toHaveBeenCalledWith('#1c2020');
    expect(target.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#1c2020',
      symbolColor: '#eeeeee',
      height: 44,
    });
    expect(target.setAccentColor).toHaveBeenCalledWith('#1c2020');
    target.setTitleBarOverlay.mockClear();
    target.setAccentColor.mockClear();
    applyWindowTheme(target, { background: '#ffffff', foreground: '#222222' }, 'darwin');
    expect(target.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(target.setAccentColor).not.toHaveBeenCalled();
  });
  it('preserves the optional approved palette, code typography and right-group settings', () => {
    const settings = {
      ...defaultSettings,
      appearance: {
        ...defaultSettings.appearance,
        palette: 'moss',
        codeFontSize: 16,
        codeLineHeight: 1.6,
      },
      rightGroups: { tags: true, backlinks: false },
    };
    expect(settingsSchema.parse(settings)).toEqual(settings);
    expect(
      settingsSchema.safeParse({
        ...settings,
        appearance: { ...settings.appearance, codeFontSize: 1 },
      }).success,
    ).toBe(false);
  });
});
