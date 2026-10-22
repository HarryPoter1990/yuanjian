import { useCallback, useEffect, useRef, useState } from 'react';
import type { WindowMode, WindowModeState } from '../shared/types';
import { errorText } from './model';

export function useWindowMode(onError: (message: string) => void) {
  const [state, setState] = useState<WindowModeState>({ mode: 'full', pinned: false });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const current = useRef(state);
  const inflight = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true);
  const apply = useCallback((next: WindowModeState) => {
    current.current = next;
    if (alive.current) setState(next);
  }, []);
  useEffect(() => {
    alive.current = true;
    setReady(false);
    const api = window.notes;
    if (
      !api ||
      typeof api.getWindowMode !== 'function' ||
      typeof api.onWindowModeChanged !== 'function' ||
      typeof api.setWindowMode !== 'function' ||
      typeof api.setStickyPinned !== 'function'
    )
      return () => {
        alive.current = false;
      };
    let eventReceived = false;
    let stop = () => {};
    const failed = (reason: unknown) => {
      if (alive.current) onError(`窗口模式读取失败：${errorText(reason)}`);
    };
    try {
      stop = api.onWindowModeChanged((next) => {
        eventReceived = true;
        apply(next);
      });
      void Promise.resolve()
        .then(() => api.getWindowMode())
        .then((next) => {
          if (!alive.current) return;
          if (!eventReceived) apply(next);
          setReady(true);
        })
        .catch(failed);
    } catch (reason) {
      failed(reason);
    }
    return () => {
      alive.current = false;
      stop();
    };
  }, [apply, onError]);
  const perform = useCallback(
    async (action: () => Promise<WindowModeState>) => {
      if (inflight.current) await inflight.current;
      setPending(true);
      const operation = Promise.resolve()
        .then(action)
        .then((next) => {
          apply(next);
          return true;
        })
        .catch((reason) => {
          onError(`窗口模式切换失败：${errorText(reason)}`);
          return false;
        })
        .finally(() => {
          inflight.current = null;
          if (alive.current) setPending(false);
        });
      inflight.current = operation;
      return operation;
    },
    [apply, onError],
  );
  const change = useCallback(
    async (mode: WindowMode) => {
      if (inflight.current) await inflight.current;
      if (current.current.mode === mode) return true;
      return perform(async () => {
        const next = await window.notes.setWindowMode(mode);
        if (next.mode !== mode) throw new Error('窗口未进入请求的模式，请重试。');
        return next;
      });
    },
    [perform],
  );
  const pin = useCallback(async () => {
    if (inflight.current || current.current.mode !== 'sticky') return false;
    return perform(() => window.notes.setStickyPinned(!current.current.pinned));
  }, [perform]);
  return { ...state, ready, pending, change, pin };
}
