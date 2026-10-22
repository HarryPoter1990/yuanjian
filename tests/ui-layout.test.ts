import { describe, expect, it, vi } from 'vitest';
import { frameValue, panelWidth, visiblePanels } from '../src/ui/layout';

const preferences = { leftVisible: true, rightVisible: true, leftWidth: 254, rightWidth: 228 };
describe('responsive desktop layout', () => {
  it('collapses the right panel before the left without changing saved choices', () => {
    expect(visiblePanels(preferences, 1440)).toEqual({ left: true, right: true });
    expect(visiblePanels(preferences, 900)).toEqual({ left: true, right: false });
    expect(visiblePanels(preferences, 650)).toEqual({ left: false, right: false });
    expect(preferences).toMatchObject({ leftVisible: true, rightVisible: true });
    expect(visiblePanels(preferences, 1440)).toEqual({ left: true, right: true });
  });
  it('preserves manual closure on expansion and allows an explicit narrow-window opening', () => {
    expect(visiblePanels({ ...preferences, rightVisible: false }, 1440).right).toBe(false);
    expect(visiblePanels(preferences, 650, { left: true })).toEqual({ left: true, right: false });
    expect(visiblePanels(preferences, 650, { right: true })).toEqual({ left: false, right: true });
  });
  it('coalesces pointer moves into a frame and flushes the last width on release', () => {
    const apply = vi.fn();
    let scheduled: FrameRequestCallback | undefined;
    const request = vi.fn((callback: FrameRequestCallback) => {
      scheduled = callback;
      return 9;
    });
    const cancel = vi.fn();
    const values = frameValue(apply, request, cancel);
    values.push(260);
    values.push(270);
    values.push(288);
    expect(request).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    scheduled?.(0);
    expect(apply).toHaveBeenLastCalledWith(288);
    values.push(300);
    values.flush();
    expect(apply).toHaveBeenLastCalledWith(300);
    values.push(310);
    values.cancel();
    values.flush();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(panelWidth(999)).toBe(440);
    expect(panelWidth(40)).toBe(175);
  });
});
