import { describe, expect, it, vi } from 'vitest';
import { WindowModeController } from '../electron/window-mode';
import type { WindowBounds, WindowState } from '../electron/window-state';

const area = { x: 1920, y: 0, width: 1600, height: 1000 };
const full = { x: 2020, y: 40, width: 1200, height: 800 };
function setup(initial: WindowState = { bounds: full, maximized: true }) {
  let bounds = { ...initial.bounds };
  let max = false;
  let min = false;
  let areas = [area];
  let minimum = { width: 0, height: 0 };
  let controller: WindowModeController;
  const target = {
    isDestroyed: () => false,
    getNormalBounds: () => ({ ...bounds }),
    isMaximized: () => max,
    isMinimized: () => min,
    setMinimumSize: vi.fn((width: number, height: number) => {
      minimum = { width, height };
    }),
    setAlwaysOnTop: vi.fn(),
    setBounds: (value: WindowBounds) => {
      bounds = {
        ...value,
        width: Math.max(value.width, minimum.width),
        height: Math.max(value.height, minimum.height),
      };
      controller?.recordGeometry();
    },
    maximize: () => {
      max = true;
      controller?.recordGeometry();
      controller?.recordNativeState();
    },
    unmaximize: () => {
      max = false;
      controller?.recordGeometry();
      controller?.recordNativeState();
    },
    restore: () => {
      min = false;
      max = false;
      controller?.recordNativeState();
    },
  };
  const save = vi.fn(async (_value: WindowState) => {});
  const changed = vi.fn();
  const failed = vi.fn();
  controller = new WindowModeController(target, initial, {
    workAreas: () => areas,
    currentWorkArea: () => area,
    save,
    changed,
    failed,
  });
  controller.start();
  return {
    controller,
    target,
    save,
    changed,
    failed,
    resize: target.setBounds,
    minimize: () => {
      min = true;
      max = false;
      controller.recordNativeState();
    },
    setDisplays: (next: WindowBounds[]) => {
      areas = next;
      controller.fitDisplays();
    },
  };
}

describe('single-window sticky mode', () => {
  it.each(['full', 'sticky'] as const)(
    'lowers %s native minimums when fitting a minimized window onto a smaller display',
    async (mode) => {
      const { controller, target, minimize, setDisplays } = setup();
      if (mode === 'sticky') await controller.setMode('sticky');
      minimize();
      const smaller = {
        x: 0,
        y: 0,
        width: mode === 'sticky' ? 240 : 500,
        height: mode === 'sticky' ? 200 : 400,
      };
      setDisplays([smaller]);
      expect(target.setMinimumSize).toHaveBeenLastCalledWith(smaller.width, smaller.height);
      expect(target.getNormalBounds()).toEqual(smaller);
      expect(target.isMinimized()).toBe(true);
      expect(controller.getMode()).toEqual({ mode, pinned: mode === 'sticky' });
      controller.dispose();
    },
  );
  it('remembers sticky resize and pin choice, but every restart begins full and unpinned', async () => {
    const { controller, target, save, resize } = setup({ bounds: full, maximized: false });
    await controller.setMode('sticky');
    const compact = { x: 2800, y: 100, width: 380, height: 500 };
    resize(compact);
    await controller.setPinned(false);
    await controller.setMode('full');
    await controller.setMode('sticky');
    expect(target.getNormalBounds()).toEqual(compact);
    expect(target.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    const saved = save.mock.calls.at(-1)![0];
    controller.dispose();
    const restarted = setup(saved);
    expect(restarted.controller.getMode()).toEqual({ mode: 'full', pinned: false });
    expect(restarted.target.getNormalBounds()).toEqual(full);
    await restarted.controller.setMode('sticky');
    expect(restarted.target.getNormalBounds()).toEqual(compact);
    expect(restarted.controller.getMode().pinned).toBe(false);
    restarted.controller.dispose();
  });
  it('turns native sticky maximization into full maximization without recording its resize as full bounds', async () => {
    const { controller, target, save } = setup({ bounds: full, maximized: false });
    await controller.setMode('sticky');
    target.maximize();
    await controller.persist();
    expect(controller.getMode()).toEqual({ mode: 'full', pinned: false });
    expect(target.isMaximized()).toBe(true);
    expect(target.getNormalBounds()).toEqual(full);
    expect(save.mock.calls.at(-1)![0]).toMatchObject({ bounds: full, maximized: true });
    controller.dispose();
  });
  it('fits both rectangles after display removal while minimized, preserving full maximization intent', async () => {
    const { controller, target, save, minimize, setDisplays } = setup();
    await controller.setMode('sticky');
    await controller.setMode('full');
    minimize();
    setDisplays([{ x: 0, y: 0, width: 1000, height: 700 }]);
    expect(target.isMinimized()).toBe(true);
    await controller.persist();
    expect(save.mock.calls.at(-1)![0]).toEqual({
      bounds: { x: 0, y: 0, width: 1000, height: 700 },
      maximized: true,
      sticky: { bounds: { x: 580, y: 24, width: 420, height: 640 }, pinned: true },
    });
    controller.dispose();
  });
  it('reports a persistence failure and publishes the actual already-switched mode', async () => {
    const { controller, target, save, changed, failed } = setup();
    save.mockRejectedValueOnce(new Error('disk full'));
    await expect(controller.setMode('sticky')).rejects.toThrow('disk full');
    expect(controller.getMode()).toEqual({ mode: 'sticky', pinned: true });
    expect(target.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    expect(changed).toHaveBeenLastCalledWith({ mode: 'sticky', pinned: true });
    expect(failed).toHaveBeenCalledOnce();
    save.mockRejectedValueOnce(new Error('permission denied'));
    await expect(controller.setMode('full')).rejects.toThrow('permission denied');
    expect(controller.getMode()).toEqual({ mode: 'full', pinned: false });
    expect(changed).toHaveBeenLastCalledWith({ mode: 'full', pinned: false });
    expect(target.getNormalBounds()).toEqual(full);
    expect(target.isMaximized()).toBe(true);
    expect(target.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(failed).toHaveBeenCalledTimes(2);
    await controller.persist();
    expect(save.mock.calls.at(-1)![0]).toMatchObject({ bounds: full, maximized: true });
    controller.dispose();
  });
  it('rejects full-mode pin changes and reports background persistence errors', async () => {
    vi.useFakeTimers();
    const { controller, save, failed, resize } = setup({ bounds: full, maximized: false });
    try {
      await expect(controller.setPinned(true)).rejects.toThrow('仅便笺模式');
      save.mockRejectedValueOnce(new Error('permission denied'));
      resize({ ...full, width: 1000 });
      await vi.advanceTimersByTimeAsync(250);
      expect(failed).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
      vi.useRealTimers();
    }
  });
  it.each(['setMinimumSize', 'setAlwaysOnTop'] as const)(
    'rolls back partial native changes without contaminating full bounds when %s fails',
    async (setter) => {
      const { controller, target, save, failed } = setup();
      target[setter].mockImplementationOnce(() => {
        throw new Error('native setter failed');
      });
      await expect(controller.setMode('sticky')).rejects.toThrow('native setter failed');
      expect(controller.getMode()).toEqual({ mode: 'full', pinned: false });
      expect(target.getNormalBounds()).toEqual(full);
      expect(target.isMaximized()).toBe(true);
      expect(target.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
      expect(save).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledOnce();
      controller.dispose();
    },
  );
  it('keeps the prior pin preference and reports native pin failures', async () => {
    const { controller, target, save, failed } = setup();
    await controller.setMode('sticky');
    save.mockClear();
    target.setAlwaysOnTop.mockImplementationOnce(() => {
      throw new Error('pin failed');
    });
    await expect(controller.setPinned(false)).rejects.toThrow('pin failed');
    expect(controller.getMode()).toEqual({ mode: 'sticky', pinned: true });
    expect(failed).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('separates full maximized bounds from first-use sticky geometry despite native event ordering', async () => {
    const { controller, target, save } = setup();
    expect(controller.getMode()).toEqual({ mode: 'full', pinned: false });
    expect(target.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(await controller.setMode('sticky')).toEqual({ mode: 'sticky', pinned: true });
    expect(target.getNormalBounds()).toEqual({ x: 3076, y: 24, width: 420, height: 640 });
    expect(target.setMinimumSize).toHaveBeenLastCalledWith(320, 280);
    expect(await controller.setMode('full')).toEqual({ mode: 'full', pinned: false });
    expect(target.getNormalBounds()).toEqual(full);
    expect(target.isMaximized()).toBe(true);
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ bounds: full, maximized: true });
    controller.dispose();
  });
});
