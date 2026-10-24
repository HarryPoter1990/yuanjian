import path from 'node:path';
import { z } from 'zod';
import { OperationQueue, readOptional, writeJson } from './storage/io';

export const MIN_WINDOW_WIDTH = 600;
export const MIN_WINDOW_HEIGHT = 480;
export const TITLE_BAR_HEIGHT = 44;
export const MIN_STICKY_WIDTH = 320;
export const MIN_STICKY_HEIGHT = 280;
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState {
  bounds: WindowBounds;
  maximized: boolean;
  sticky?: { bounds: WindowBounds; pinned: boolean };
}
export interface WindowTheme {
  background: string;
  foreground: string;
}

const coordinate = z.number().int().min(-10_000_000).max(10_000_000);
const boundsSchema = z
  .object({
    x: coordinate,
    y: coordinate,
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
  })
  .strict();
const stateSchema = z
  .object({
    bounds: boundsSchema,
    maximized: z.boolean(),
    sticky: z.object({ bounds: boundsSchema, pinned: z.boolean() }).strict().optional(),
  })
  .strict();

function intersectionArea(left: WindowBounds, right: WindowBounds): number {
  return (
    Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) *
    Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
  );
}

export function fitWindowBounds(
  bounds: WindowBounds,
  workAreas: readonly WindowBounds[],
  minimumWidth = MIN_WINDOW_WIDTH,
  minimumHeight = MIN_WINDOW_HEIGHT,
): WindowBounds {
  const usable = workAreas.filter(
    (area) => Object.values(area).every(Number.isFinite) && area.width > 0 && area.height > 0,
  );
  const areas = usable.length ? usable : [{ x: 0, y: 0, width: 1920, height: 1080 }];
  const primary = areas[0];
  const area = areas.reduce(
    (best, candidate) =>
      intersectionArea(bounds, candidate) > intersectionArea(bounds, best) ? candidate : best,
    primary,
  );
  const width = Math.round(
    Math.min(area.width, Math.max(Math.min(minimumWidth, area.width), bounds.width)),
  );
  const height = Math.round(
    Math.min(area.height, Math.max(Math.min(minimumHeight, area.height), bounds.height)),
  );
  const x = Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)));
  const y = Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)));
  return { x, y, width, height };
}

export function centerWindowBounds(bounds: WindowBounds, workArea: WindowBounds): WindowBounds {
  const area =
    Object.values(workArea).every(Number.isFinite) && workArea.width > 0 && workArea.height > 0
      ? workArea
      : { x: 0, y: 0, width: 1920, height: 1080 };
  const fitted = fitWindowBounds(bounds, [area]);
  return {
    ...fitted,
    x: Math.round(area.x + (area.width - fitted.width) / 2),
    y: Math.round(area.y + (area.height - fitted.height) / 2),
  };
}

export function restoreWindowState(
  raw: unknown,
  workAreas: readonly WindowBounds[],
  centerIn?: WindowBounds,
): WindowState {
  const parsed = stateSchema.safeParse(raw);
  const primary = workAreas.find(
    (area) => Object.values(area).every(Number.isFinite) && area.width > 0 && area.height > 0,
  ) ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const width = Math.min(1440, primary.width);
  const height = Math.min(940, primary.height);
  const saved = parsed.success
    ? parsed.data
    : {
        bounds: {
          x: primary.x + (primary.width - width) / 2,
          y: primary.y + (primary.height - height) / 2,
          width,
          height,
        },
        maximized: false,
      };
  return {
    bounds: centerIn
      ? centerWindowBounds(saved.bounds, centerIn)
      : fitWindowBounds(saved.bounds, workAreas),
    maximized: saved.maximized,
    ...(saved.sticky
      ? {
          sticky: {
            bounds: fitWindowBounds(
              saved.sticky.bounds,
              workAreas,
              MIN_STICKY_WIDTH,
              MIN_STICKY_HEIGHT,
            ),
            pinned: saved.sticky.pinned,
          },
        }
      : {}),
  };
}

export function captureWindowState(
  target: { getNormalBounds(): WindowBounds; isMaximized(): boolean; isMinimized(): boolean },
  previous?: WindowState,
  captureBounds = true,
): WindowState {
  return {
    ...(previous?.sticky ? { sticky: structuredClone(previous.sticky) } : {}),
    bounds: { ...(captureBounds || !previous ? target.getNormalBounds() : previous.bounds) },
    maximized: target.isMinimized()
      ? (previous?.maximized ?? target.isMaximized())
      : target.isMaximized(),
  };
}

export function restoreWindowBounds(
  target: { getNormalBounds(): WindowBounds; setBounds(bounds: WindowBounds): void },
  desired: WindowBounds,
): WindowBounds {
  // Electron's Windows fractional-DPI conversions are not inverse operations (#51572).
  let requested = { ...desired };
  let actual = target.getNormalBounds();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (Object.keys(desired).every((key) => Reflect.get(actual, key) === Reflect.get(desired, key)))
      break;
    requested = {
      x: requested.x + desired.x - actual.x,
      y: requested.y + desired.y - actual.y,
      width: requested.width + desired.width - actual.width,
      height: requested.height + desired.height - actual.height,
    };
    if (requested.width <= 0 || requested.height <= 0) break;
    target.setBounds(requested);
    actual = target.getNormalBounds();
  }
  return { ...actual };
}

export class WindowStateStore {
  private readonly file: string;
  private readonly queue = new OperationQueue();
  constructor(dataDirectory: string) {
    this.file = path.join(dataDirectory, 'window-state.json');
  }
  async load(workAreas: readonly WindowBounds[], centerIn?: WindowBounds): Promise<WindowState> {
    const bytes = await readOptional(this.file);
    let raw: unknown;
    try {
      raw = bytes ? JSON.parse(bytes.toString('utf8')) : undefined;
    } catch {
      raw = undefined;
    }
    return restoreWindowState(raw, workAreas, centerIn);
  }
  save(state: WindowState): Promise<void> {
    const checked = stateSchema.parse(state);
    return this.queue.run(() => writeJson(this.file, checked));
  }
}

export function applyWindowTheme(
  target: {
    setBackgroundColor(color: string): void;
    setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void;
    setAccentColor(color: string): void;
  },
  theme: WindowTheme,
  platform: NodeJS.Platform = process.platform,
): void {
  target.setBackgroundColor(theme.background);
  if (platform !== 'win32') return;
  target.setTitleBarOverlay({
    color: theme.background,
    symbolColor: theme.foreground,
    height: TITLE_BAR_HEIGHT,
  });
  target.setAccentColor(theme.background);
}
