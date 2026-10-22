import path from 'node:path';
import { z } from 'zod';
import { OperationQueue, readOptional, writeJson } from './storage/io';

export const MIN_WINDOW_WIDTH = 600;
export const MIN_WINDOW_HEIGHT = 480;
export const TITLE_BAR_HEIGHT = 44;
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState {
  bounds: WindowBounds;
  maximized: boolean;
}
export interface WindowTheme {
  background: string;
  foreground: string;
}

const coordinate = z.number().int().min(-10_000_000).max(10_000_000);
const stateSchema = z
  .object({
    bounds: z
      .object({
        x: coordinate,
        y: coordinate,
        width: z.number().int().min(1).max(100_000),
        height: z.number().int().min(1).max(100_000),
      })
      .strict(),
    maximized: z.boolean(),
  })
  .strict();

function intersectionArea(left: WindowBounds, right: WindowBounds): number {
  return (
    Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) *
    Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
  );
}

export function restoreWindowState(raw: unknown, workAreas: readonly WindowBounds[]): WindowState {
  const usable = workAreas.filter(
    (area) => Object.values(area).every(Number.isFinite) && area.width > 0 && area.height > 0,
  );
  const areas = usable.length ? usable : [{ x: 0, y: 0, width: 1920, height: 1080 }];
  const parsed = stateSchema.safeParse(raw);
  const primary = areas[0];
  const saved = parsed.success ? parsed.data : null;
  const area = saved
    ? areas.reduce(
        (best, candidate) =>
          intersectionArea(saved.bounds, candidate) > intersectionArea(saved.bounds, best)
            ? candidate
            : best,
        primary,
      )
    : primary;
  const width = Math.round(
    Math.min(
      area.width,
      Math.max(Math.min(MIN_WINDOW_WIDTH, area.width), saved?.bounds.width ?? 1440),
    ),
  );
  const height = Math.round(
    Math.min(
      area.height,
      Math.max(Math.min(MIN_WINDOW_HEIGHT, area.height), saved?.bounds.height ?? 940),
    ),
  );
  const x = Math.round(
    Math.max(
      area.x,
      Math.min(saved?.bounds.x ?? area.x + (area.width - width) / 2, area.x + area.width - width),
    ),
  );
  const y = Math.round(
    Math.max(
      area.y,
      Math.min(
        saved?.bounds.y ?? area.y + (area.height - height) / 2,
        area.y + area.height - height,
      ),
    ),
  );
  return { bounds: { x, y, width, height }, maximized: saved?.maximized ?? false };
}

export function captureWindowState(
  target: { getNormalBounds(): WindowBounds; isMaximized(): boolean; isMinimized(): boolean },
  previous?: WindowState,
): WindowState {
  return {
    bounds: { ...target.getNormalBounds() },
    maximized: target.isMinimized()
      ? (previous?.maximized ?? target.isMaximized())
      : target.isMaximized(),
  };
}

export class WindowStateStore {
  private readonly file: string;
  private readonly queue = new OperationQueue();
  constructor(dataDirectory: string) {
    this.file = path.join(dataDirectory, 'window-state.json');
  }
  async load(workAreas: readonly WindowBounds[]): Promise<WindowState> {
    const bytes = await readOptional(this.file);
    let raw: unknown;
    try {
      raw = bytes ? JSON.parse(bytes.toString('utf8')) : undefined;
    } catch {
      raw = undefined;
    }
    return restoreWindowState(raw, workAreas);
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
