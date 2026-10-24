import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { ViewTab } from '../shared/types';
import { viewKey } from './viewTabs';
interface Marker {
  key: string;
  before: string | null;
  left: number;
}
export function useTabDrag(
  order: ViewTab[],
  scroller: RefObject<HTMLDivElement | null>,
  onReorder: (order: ViewTab[]) => void,
) {
  const [marker, setMarker] = useState<Marker | null>(null);
  const latest = useRef({ order, onReorder });
  latest.current = { order, onReorder };
  const dispose = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => dispose.current?.(), []);
  function begin(event: PointerEvent<HTMLElement>, view: ViewTab) {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('.icon-button'))
    )
      return;
    suppressClick.current = false;
    dispose.current?.();
    const bar = scroller.current;
    if (!bar) return;
    const key = viewKey(view),
      startX = event.clientX,
      startY = event.clientY,
      pointerId = event.pointerId;
    let x = startX,
      y = startY,
      moved = false,
      frame = 0,
      current: Marker | null = null;
    const show = (value: Marker | null) => {
      current = value;
      setMarker((previous) =>
        previous?.key === value?.key &&
        previous?.before === value?.before &&
        previous?.left === value?.left
          ? previous
          : value,
      );
    };
    const update = () => {
      if (!moved && Math.hypot(x - startX, y - startY) < 5) return;
      moved = true;
      suppressClick.current = true;
      const box = bar.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
        show(null);
        return;
      }
      const candidates = [...bar.querySelectorAll<HTMLElement>('[data-view-key]')].filter(
        (el) => el.dataset.viewKey !== key,
      );
      const before = candidates.find((el) => {
        const b = el.getBoundingClientRect();
        return x < b.left + b.width / 2;
      });
      const end = candidates.at(-1)?.getBoundingClientRect().right ?? box.left;
      show({
        key,
        before: before?.dataset.viewKey ?? null,
        left: (before?.getBoundingClientRect().left ?? end) - box.left + bar.scrollLeft,
      });
    };
    const tick = () => {
      if (moved) {
        const box = bar.getBoundingClientRect();
        if (y >= box.top && y <= box.bottom && x >= box.left && x <= box.right) {
          const edge = 28;
          const speed = x < box.left + edge ? -12 : x > box.right - edge ? 12 : 0;
          if (speed) {
            bar.scrollLeft += speed;
            update();
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      update();
      if (moved) e.preventDefault();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('blur', cancel);
      cancelAnimationFrame(frame);
      setMarker(null);
      dispose.current = null;
    };
    const cancel = () => cleanup();
    const end = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      update();
      if (moved && current) {
        const source = latest.current.order.find((v) => viewKey(v) === key);
        if (source) {
          const rest = latest.current.order.filter((v) => viewKey(v) !== key);
          const at =
            current.before === null
              ? rest.length
              : rest.findIndex((v) => viewKey(v) === current!.before);
          if (at >= 0) {
            const next = [...rest.slice(0, at), source, ...rest.slice(at)];
            if (next.some((v, i) => viewKey(v) !== viewKey(latest.current.order[i])))
              latest.current.onReorder(next);
          }
        }
      }
      cleanup();
    };
    const keyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('blur', cancel);
    frame = requestAnimationFrame(tick);
    dispose.current = cleanup;
  }
  return { marker, begin, allowClick: (detail: number) => detail === 0 || !suppressClick.current };
}
