import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WindowStateStore, type WindowBounds, type WindowState } from '../electron/window-state';
import { WindowModeController } from '../electron/window-mode';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: -1600, y: 40, width: 1600, height: 900 };
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function stateStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-center-'));
  directories.push(directory);
  return new WindowStateStore(directory);
}
function setup(maximized = false) {
  const initial: WindowState = {
    bounds: { x: -1600, y: 40, width: 1000, height: 700 },
    maximized,
    sticky: { bounds: { x: -500, y: 100, width: 400, height: 600 }, pinned: false },
  };
  let bounds = { ...initial.bounds };
  let max = false;
  let min = false;
  let controller: WindowModeController;
  const target = {
    isDestroyed: () => false,
    getNormalBounds: () => ({ ...bounds }),
    isMaximized: () => max,
    isMinimized: () => min,
    setMinimumSize: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setBounds: vi.fn((next: WindowBounds) => {
      bounds = { ...next };
      controller?.recordGeometry();
    }),
    maximize: vi.fn(() => {
      max = true;
      controller?.recordNativeState();
    }),
    unmaximize: vi.fn(() => {
      max = false;
      controller?.recordNativeState();
    }),
    restore: vi.fn(() => {
      min = false;
      max = false;
      controller?.recordNativeState();
    }),
  };
  const save = vi.fn(async (_state: WindowState) => {});
  const failed = vi.fn();
  controller = new WindowModeController(target, initial, {
    workAreas: () => [primary, secondary],
    currentWorkArea: () => secondary,
    save,
    failed,
    changed() {},
  });
  controller.start();
  for (const fn of [
    target.setBounds,
    target.maximize,
    target.unmaximize,
    target.restore,
    target.setAlwaysOnTop,
    save,
  ])
    fn.mockClear();
  return { controller, target, save, failed, initial };
}

describe('explicit window centering preserves independent layout preferences', () => {
  it('centers startup on the supplied pointer display, retaining size, maximized intent and sticky position', async () => {
    const store = await stateStore();
    const saved: WindowState = {
      bounds: { x: 0, y: 0, width: 900, height: 650 },
      maximized: true,
      sticky: { bounds: { x: -500, y: 100, width: 400, height: 600 }, pinned: false },
    };
    await store.save(saved);
    const restored = await store.load([primary, secondary], secondary);
    expect(restored).toEqual({ ...saved, bounds: { x: -1250, y: 165, width: 900, height: 650 } });
    expect(await store.load([primary, secondary])).toEqual(saved);
  });
  it('fits a saved large startup size to a smaller pointer work area instead of restoring offscreen', async () => {
    const store = await stateStore();
    await store.save({ bounds: { x: 0, y: 0, width: 1300, height: 900 }, maximized: false });
    const small = { x: 2000, y: 80, width: 500, height: 350 };
    expect((await store.load([primary, small], small)).bounds).toEqual(small);
  });
  it('centers default startup bounds on the pointer screen when no state file exists', async () => {
    const store = await stateStore();
    const restored = await store.load([primary, secondary], secondary);
    expect(restored.bounds).toEqual({ x: -1520, y: 40, width: 1440, height: 900 });
    expect(restored.maximized).toBe(false);
  });
  it('retains the saved size before fitting to the pointer screen rather than shrinking it on the old screen first', async () => {
    const store = await stateStore();
    const oldScreen = { x: -1000, y: 0, width: 1000, height: 700 };
    await store.save({ bounds: { x: -1000, y: 0, width: 1800, height: 900 }, maximized: false });
    const restored = await store.load([primary, oldScreen], primary);
    expect(restored.bounds).toEqual({ x: 60, y: 70, width: 1800, height: 900 });
  });
  it('centers a normal full window on its current display while preserving its dimensions', async () => {
    const { controller, target, save, initial } = setup();
    try {
      expect(target.getNormalBounds()).toEqual(initial.bounds);
      await controller.center();
      expect(target.getNormalBounds()).toEqual({ x: -1300, y: 140, width: 1000, height: 700 });
      expect(save.mock.calls.at(-1)?.[0]).toEqual({ ...initial, bounds: target.getNormalBounds() });
      expect(target.isMaximized()).toBe(false);
    } finally {
      controller.dispose();
    }
  });
  it('leaves an already maximized window maximized without native unmaximize or bounds flashes', async () => {
    const { controller, target } = setup(true);
    try {
      await controller.center();
      expect(target.isMaximized()).toBe(true);
      expect(target.unmaximize).not.toHaveBeenCalled();
      expect(target.maximize).not.toHaveBeenCalled();
      expect(target.setBounds).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });
  it('calibrates native bounds rounding during centering without contaminating the saved size', async () => {
    const { controller, target, save } = setup();
    const setNative = target.setBounds.getMockImplementation()!;
    target.setBounds.mockImplementation((next) =>
      setNative({
        ...next,
        x: next.x + 1,
        y: next.y + 1,
        width: next.width + 1,
        height: next.height + 1,
      }),
    );
    try {
      await controller.center();
      const expected = { x: -1300, y: 140, width: 1000, height: 700 };
      expect(target.getNormalBounds()).toEqual(expected);
      expect(save.mock.calls.at(-1)?.[0].bounds).toEqual(expected);
    } finally {
      controller.dispose();
    }
  });
  it('does not move or toggle pinning in sticky mode and keeps that position after full centering', async () => {
    const { controller, target, initial } = setup();
    try {
      await controller.setMode('sticky');
      target.setBounds.mockClear();
      target.setAlwaysOnTop.mockClear();
      await controller.center();
      expect(target.getNormalBounds()).toEqual(initial.sticky!.bounds);
      expect(target.setBounds).not.toHaveBeenCalled();
      expect(target.setAlwaysOnTop).not.toHaveBeenCalled();
      await controller.setMode('full');
      await controller.center();
      await controller.setMode('sticky');
      expect(target.getNormalBounds()).toEqual(initial.sticky!.bounds);
    } finally {
      controller.dispose();
    }
  });
  it('keeps the actual centered position if saving the preference fails and reports the error', async () => {
    const { controller, target, save, failed } = setup();
    try {
      save.mockRejectedValueOnce(new Error('生成窗口记录失败'));
      await expect(controller.center()).rejects.toThrow('生成窗口记录失败');
      expect(target.getNormalBounds()).toEqual({ x: -1300, y: 140, width: 1000, height: 700 });
      expect(failed).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
    }
  });
  it('restores previous bounds and reports a native centering failure', async () => {
    const { controller, target, failed, initial } = setup();
    try {
      target.setBounds.mockImplementationOnce(() => {
        throw new Error('生成原生移动失败');
      });
      await expect(controller.center()).rejects.toThrow('生成原生移动失败');
      expect(target.getNormalBounds()).toEqual(initial.bounds);
      expect(failed).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
    }
  });
});
