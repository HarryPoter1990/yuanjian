interface PanelPreferences {
  leftVisible: boolean;
  rightVisible: boolean;
  leftWidth: number;
  rightWidth: number;
}

export function visiblePanels(
  settings: PanelPreferences,
  width: number,
  forced: { left?: boolean; right?: boolean } = {},
) {
  let left = settings.leftVisible;
  let right = settings.rightVisible;
  const needed = () =>
    460 + (left ? settings.leftWidth + 8 : 0) + (right ? settings.rightWidth + 8 : 0);
  if (width < needed() && !forced.right) right = false;
  if (width < needed() && !forced.left) left = false;
  return { left, right };
}

export function panelWidth(value: number): number {
  return Math.round(Math.max(175, Math.min(440, value)));
}

export function frameValue(
  apply: (value: number) => void,
  schedule: (callback: FrameRequestCallback) => number,
  cancel: (frame: number) => void,
) {
  let frame: number | undefined;
  let latest: number | undefined;
  const flush = () => {
    if (frame !== undefined) cancel(frame);
    frame = undefined;
    if (latest !== undefined) {
      apply(latest);
      latest = undefined;
    }
  };
  return {
    push(value: number) {
      latest = value;
      if (frame === undefined) frame = schedule(flush);
    },
    flush,
    cancel() {
      if (frame !== undefined) cancel(frame);
      frame = undefined;
      latest = undefined;
    },
  };
}
