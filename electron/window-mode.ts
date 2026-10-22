import type { WindowMode, WindowModeState } from '../src/shared/types';
import {
  captureWindowState,
  fitWindowBounds,
  MIN_STICKY_HEIGHT,
  MIN_STICKY_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  restoreWindowBounds,
  restoreWindowState,
  type WindowBounds,
  type WindowState,
} from './window-state';

interface NativeWindow {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  isMinimized(): boolean;
  getNormalBounds(): WindowBounds;
  setBounds(bounds: WindowBounds): void;
  setMinimumSize(width: number, height: number): void;
  setAlwaysOnTop(pinned: boolean): void;
  maximize(): void;
  unmaximize(): void;
  restore(): void;
}
interface Adapters {
  workAreas(): WindowBounds[];
  currentWorkArea(): WindowBounds;
  save(state: WindowState): Promise<void>;
  changed(state: WindowModeState): void;
  failed(error: unknown): void;
}

export class WindowModeController {
  private mode: WindowMode = 'full';
  private applying = true;
  private state: WindowState;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly target: NativeWindow,
    initial: WindowState,
    private readonly adapters: Adapters,
  ) {
    this.state = structuredClone(initial);
  }
  getMode(): WindowModeState {
    return {
      mode: this.mode,
      pinned: this.mode === 'sticky' && (this.state.sticky?.pinned ?? true),
    };
  }
  start(): void {
    this.applyGeometry();
    this.publish();
  }
  private publish(): void {
    this.adapters.changed(this.getMode());
  }
  private stickyState(state = this.state): NonNullable<WindowState['sticky']> {
    if (!state.sticky) {
      const area = this.adapters.currentWorkArea();
      state.sticky = {
        bounds: fitWindowBounds(
          { x: area.x + area.width - 420 - 24, y: area.y + 24, width: 420, height: 640 },
          [area],
          MIN_STICKY_WIDTH,
          MIN_STICKY_HEIGHT,
        ),
        pinned: true,
      };
    }
    return state.sticky;
  }
  private applyGeometry(mode = this.mode, state = this.state): void {
    this.applying = true;
    try {
      if (this.target.isMinimized()) this.target.restore();
      if (this.target.isMaximized()) this.target.unmaximize();
      const sticky = mode === 'sticky';
      const bounds = sticky ? this.stickyState(state).bounds : state.bounds;
      this.target.setMinimumSize(
        Math.min(sticky ? MIN_STICKY_WIDTH : MIN_WINDOW_WIDTH, bounds.width),
        Math.min(sticky ? MIN_STICKY_HEIGHT : MIN_WINDOW_HEIGHT, bounds.height),
      );
      this.target.setBounds(bounds);
      restoreWindowBounds(this.target, bounds);
      if (!sticky && state.maximized) this.target.maximize();
      this.target.setAlwaysOnTop(sticky && this.stickyState(state).pinned);
    } finally {
      this.applying = false;
    }
  }
  async setMode(mode: WindowMode, maximize = false): Promise<WindowModeState> {
    if (this.target.isDestroyed()) throw new Error('主窗口已关闭');
    if (mode === this.mode && !maximize) return this.getMode();
    const candidate =
      this.mode === 'full'
        ? captureWindowState(this.target, this.state, false)
        : structuredClone(this.state);
    if (mode === 'full' && maximize) candidate.maximized = true;
    const next = restoreWindowState(candidate, this.adapters.workAreas());
    try {
      this.applyGeometry(mode, next);
    } catch (error) {
      let failure = error;
      try {
        this.applyGeometry();
      } catch (restoreError) {
        failure = new AggregateError([error, restoreError], '窗口切换及原状态恢复失败');
      }
      this.adapters.failed(failure);
      this.publish();
      throw failure;
    }
    this.mode = mode;
    this.state = next;
    this.publish();
    await this.persist();
    return this.getMode();
  }
  async setPinned(pinned: boolean): Promise<WindowModeState> {
    if (this.mode !== 'sticky') throw new Error('仅便笺模式可以修改置顶状态');
    if (this.target.isDestroyed()) throw new Error('主窗口已关闭');
    try {
      this.target.setAlwaysOnTop(pinned);
    } catch (error) {
      this.adapters.failed(error);
      throw error;
    }
    this.stickyState().pinned = pinned;
    this.publish();
    await this.persist();
    return this.getMode();
  }
  recordGeometry(): void {
    if (
      this.applying ||
      this.target.isDestroyed() ||
      this.target.isMinimized() ||
      this.target.isMaximized()
    )
      return;
    if (this.mode === 'sticky') this.stickyState().bounds = { ...this.target.getNormalBounds() };
    else if (!this.state.maximized) this.state = captureWindowState(this.target, this.state);
    this.scheduleSave();
  }
  recordNativeState(): void {
    if (this.applying || this.target.isDestroyed()) return;
    if (this.mode === 'sticky' && this.target.isMaximized()) {
      void this.setMode('full', true).catch(() => {});
      return;
    }
    if (this.mode === 'full') this.state = captureWindowState(this.target, this.state, false);
    this.scheduleSave();
  }
  fitDisplays(): void {
    if (this.target.isDestroyed()) return;
    const next = restoreWindowState(this.state, this.adapters.workAreas());
    const boundsChanged = JSON.stringify(next) !== JSON.stringify(this.state);
    this.state = next;
    if (boundsChanged) {
      try {
        if (this.target.isMinimized()) {
          this.applying = true;
          try {
            const sticky = this.mode === 'sticky';
            const bounds = sticky ? this.stickyState().bounds : this.state.bounds;
            this.target.setMinimumSize(
              Math.min(sticky ? MIN_STICKY_WIDTH : MIN_WINDOW_WIDTH, bounds.width),
              Math.min(sticky ? MIN_STICKY_HEIGHT : MIN_WINDOW_HEIGHT, bounds.height),
            );
            this.target.setBounds(bounds);
          } finally {
            this.applying = false;
          }
        } else this.applyGeometry();
      } catch (error) {
        this.adapters.failed(error);
      }
    }
    this.scheduleSave();
  }
  private scheduleSave(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.persist().catch(() => {});
    }, 250);
  }
  async persist(): Promise<void> {
    clearTimeout(this.timer);
    try {
      await this.adapters.save(structuredClone(this.state));
    } catch (error) {
      this.adapters.failed(error);
      throw error;
    }
  }
  dispose(): void {
    clearTimeout(this.timer);
  }
}
