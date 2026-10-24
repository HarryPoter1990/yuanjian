import { useCallback, useEffect, useRef, useState } from 'react';
import type { TabState } from '../shared/types';
import { errorText } from './model';

export type CloseDecision = 'save' | 'discard' | 'cancel';
export interface TabClosingOptions {
  getTab(id: string): TabState | undefined;
  save(id: string, explicit?: boolean): Promise<boolean>;
  removeTab(id: string): void;
  confirm(tab: TabState): Promise<CloseDecision>;
  onClosed?(tab: TabState, decision?: 'save' | 'discard'): void;
  notify(message: string, error?: boolean): void;
}

const cancelled = Symbol('tab-close-cancelled');
function waitForClose<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof cancelled> {
  return new Promise((resolve, reject) => {
    const abort = () => resolve(cancelled);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(signal.aborted ? cancelled : value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) resolve(cancelled);
        else reject(error);
      },
    );
  });
}

export function useTabClosing(options: TabClosingOptions) {
  const current = useRef(options);
  current.current = options;
  const lifetime = useRef(new AbortController());
  const mounted = useRef(true);
  const running = useRef<symbol | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  useEffect(() => {
    mounted.current = true;
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    const controller = lifetime.current;
    return () => {
      mounted.current = false;
      running.current = null;
      controller.abort();
    };
  }, []);

  async function closeOne(id: string, signal: AbortSignal): Promise<boolean> {
    try {
      const tab = current.current.getTab(id);
      if (!tab || signal.aborted) return false;
      let decision: 'save' | 'discard' | undefined;
      if (tab.dirty || (!tab.path && tab.content)) {
        const answer = await waitForClose(current.current.confirm(tab), signal);
        if (answer === cancelled || answer === 'cancel') return false;
        decision = answer;
        if (decision === 'save') {
          const saved = await waitForClose(current.current.save(id, true), signal);
          if (saved !== true) return false;
          const latest = current.current.getTab(id);
          if (!latest) return false;
          if (latest.dirty || (!latest.path && latest.content)) {
            current.current.notify('保存期间有新修改或仍有未保存内容，请再次保存后关闭。');
            return false;
          }
        }
      }
      const latest = current.current.getTab(id);
      if (!latest || signal.aborted) return false;
      current.current.onClosed?.(latest, decision);
      if (signal.aborted) return false;
      current.current.removeTab(id);
      return true;
    } catch (error) {
      if (!signal.aborted) current.current.notify(`关闭笔记未完成：${errorText(error)}`, true);
      return false;
    }
  }

  const run = useCallback(async (ids: readonly string[]): Promise<boolean> => {
    if (running.current || !mounted.current) return false;
    const token = Symbol();
    const signal = lifetime.current.signal;
    running.current = token;
    setIsClosing(true);
    try {
      for (const id of new Set(ids)) if (!(await closeOne(id, signal))) return false;
      return true;
    } finally {
      if (running.current === token) {
        running.current = null;
        if (mounted.current && !signal.aborted) setIsClosing(false);
      }
    }
  }, []);
  const requestClose = useCallback((id: string) => run([id]), [run]);
  return { isClosing, requestClose, requestCloseMany: run };
}
