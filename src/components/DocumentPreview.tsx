import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { Settings, TabState } from '../shared/types';
import { hydrateMarkdown, renderReadingMarkdown } from '../editor/renderer';
import type { EditorScrollAnchor } from '../editor/types';
import { errorText } from '../ui/model';

export interface ReadingPosition {
  cursor: number;
  scrollTop: number;
  scrollAnchor?: EditorScrollAnchor;
}
export interface DocumentPreviewHandle {
  scrollToLine(line: number): void;
  restorePosition(cursor: number, scrollTop: number, scrollAnchor?: EditorScrollAnchor): void;
  getPosition(): ReadingPosition;
}

export function DocumentPreview({
  note,
  settings,
  onLink,
  onError,
  ref,
  initialPosition,
  onPosition,
}: {
  note: TabState;
  settings: Settings;
  onLink(target: string): void;
  onError(message: string): void;
  ref?: Ref<DocumentPreviewHandle>;
  initialPosition?: ReadingPosition;
  onPosition?(position: ReadingPosition): void;
}) {
  const root = useRef<HTMLElement>(null);
  const identity = useRef('');
  const ready = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const layoutIntent = useRef<(() => void) | null>(null);
  const initial = useRef(initialPosition);
  const latestPosition = useRef<ReadingPosition>(initialPosition ?? { cursor: 0, scrollTop: 0 });
  const normalized = note.content.replace(/\r\n?/g, '\n');
  const source = useRef(normalized);
  source.current = normalized;
  const positionCallback = useRef(onPosition);
  positionCallback.current = onPosition;
  function lineFrom(cursor: number) {
    return source.current.slice(0, cursor).split('\n').length;
  }
  function blockAt(line: number) {
    const nodes = [...(root.current?.querySelectorAll<HTMLElement>('[data-source-line]') ?? [])];
    return nodes.filter((node) => Number(node.dataset.sourceLine) <= line).at(-1) ?? nodes[0];
  }
  function getPosition(): ReadingPosition {
    const scroller = root.current?.parentElement;
    if (!scroller || !ready.current) return latestPosition.current;
    const top = scroller.getBoundingClientRect().top;
    const nodes = [...root.current!.querySelectorAll<HTMLElement>('[data-source-line]')];
    const visible = nodes.filter((item) => item.getBoundingClientRect().bottom > top);
    const node =
      visible.filter((item) => item.getBoundingClientRect().top <= top).at(-1) ??
      visible[0] ??
      nodes.at(-1);
    const cursor = node
      ? source.current
          .split('\n')
          .slice(0, Number(node.dataset.sourceLine) - 1)
          .reduce((sum, line) => sum + line.length + 1, 0)
      : 0;
    latestPosition.current = {
      cursor,
      scrollTop: scroller.scrollTop,
      ...(node
        ? {
            scrollAnchor: {
              from: cursor,
              offset: node.getBoundingClientRect().top - top,
              left: scroller.scrollLeft,
            },
          }
        : {}),
    };
    return latestPosition.current;
  }
  function restorePosition(cursor: number, scrollTop: number, anchor?: EditorScrollAnchor) {
    const restore = () => {
      const scroller = root.current?.parentElement;
      if (!scroller) return;
      const node = blockAt(lineFrom(anchor?.from ?? cursor));
      if (node)
        scroller.scrollTop +=
          node.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          (anchor?.offset ?? 24);
      else scroller.scrollTop = scrollTop;
      scroller.scrollLeft = anchor?.left ?? 0;
      positionCallback.current?.(getPosition());
    };
    layoutIntent.current = restore;
    if (ready.current) restore();
    else pending.current = restore;
  }
  useImperativeHandle(ref, () => ({
    scrollToLine: (line) =>
      restorePosition(
        source.current
          .split('\n')
          .slice(0, line - 1)
          .reduce((sum, text) => sum + text.length + 1, 0),
        0,
      ),
    restorePosition,
    getPosition,
  }));
  const callbacks = useRef({ onLink, onError });
  callbacks.current = { onLink, onError };
  useEffect(() => {
    let alive = true;
    if (identity.current !== note.id) {
      identity.current = note.id;
      ready.current = false;
      if (root.current) root.current.innerHTML = '<p role="status">正在排版…</p>';
    }
    const timer = setTimeout(() => {
      if (!root.current) return;
      try {
        root.current.innerHTML = renderReadingMarkdown(note.content, {
          codeLineNumbers: settings.codeLineNumbers,
          codeWrap: settings.codeWrap,
          codeFold: settings.codeFold,
          codeFontSize: settings.appearance.codeFontSize,
          codeLineHeight: settings.appearance.codeLineHeight,
        });
        const first = !ready.current;
        ready.current = true;
        if (pending.current) {
          const restore = pending.current;
          pending.current = null;
          restore();
        } else if (first && initial.current) {
          const saved = initial.current;
          restorePosition(saved.cursor, saved.scrollTop, saved.scrollAnchor);
        }
      } catch (error) {
        root.current.textContent = '预览暂时无法排版，原文仍保留。';
        callbacks.current.onError(errorText(error));
        return;
      }
      void hydrateMarkdown(root.current, (reference) =>
        note.importSourceId
          ? window.notes.importAssetUrl(note.importSourceId, reference)
          : window.notes.assetUrl(reference, note.path ?? undefined),
      )
        .then(() => {
          if (alive) layoutIntent.current?.();
        })
        .catch((error) => {
          if (alive) callbacks.current.onError(`预览排版失败：${errorText(error)}`);
        });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    note.id,
    note.content,
    note.path,
    note.importSourceId,
    settings.codeLineNumbers,
    settings.codeWrap,
    settings.codeFold,
    settings.appearance.codeFontSize,
    settings.appearance.codeLineHeight,
  ]);
  useEffect(() => {
    const scroller = root.current?.parentElement;
    const article = root.current;
    const cancelCorrection = () => {
      layoutIntent.current = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
        cancelCorrection();
    };
    const reflow = () => {
      if (ready.current) layoutIntent.current?.();
    };
    // Asset decoding and Mermaid may change heights after the initial source jump.
    // Stop following the target as soon as the reader intentionally moves or selects.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reflow);
    if (article) observer?.observe(article);
    article?.addEventListener('load', reflow, true);
    scroller?.addEventListener('wheel', cancelCorrection, { passive: true });
    scroller?.addEventListener('touchstart', cancelCorrection, { passive: true });
    scroller?.addEventListener('pointerdown', cancelCorrection);
    scroller?.addEventListener('keydown', onKey);
    const save = () => {
      if (ready.current) positionCallback.current?.(getPosition());
    };
    scroller?.addEventListener('scroll', save, { passive: true });
    return () => {
      if (ready.current) positionCallback.current?.(latestPosition.current);
      observer?.disconnect();
      article?.removeEventListener('load', reflow, true);
      scroller?.removeEventListener('wheel', cancelCorrection);
      scroller?.removeEventListener('touchstart', cancelCorrection);
      scroller?.removeEventListener('pointerdown', cancelCorrection);
      scroller?.removeEventListener('keydown', onKey);
      scroller?.removeEventListener('scroll', save);
    };
  }, []);
  return (
    <article
      ref={root}
      className="document-preview markdown-rendered"
      aria-label="阅读预览正文"
      tabIndex={0}
      onClick={(event) => {
        const link = event.target instanceof Element ? event.target.closest('a') : null;
        const href = link?.getAttribute('href');
        if (!href) return;
        // Keyboard-activated anchors also supersede any pending layout correction.
        layoutIntent.current = null;
        event.preventDefault();
        if (href.startsWith('#')) {
          let id = href.slice(1);
          try {
            id = decodeURIComponent(id);
          } catch {
            /* malformed anchors still remain plain local targets */
          }
          const target = [...root.current!.querySelectorAll<HTMLElement>('[id]')].find(
            (node) => node.id === id,
          );
          if (target) {
            target.scrollIntoView({ block: 'start' });
            return;
          }
        }
        callbacks.current.onLink(href);
      }}
    />
  );
}
