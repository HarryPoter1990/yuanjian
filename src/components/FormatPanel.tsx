import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** A native top-layer panel; existing editor commands keep their selection and undo behavior. */
export function FormatPanel({
  anchor,
  children,
  onClose,
}: {
  anchor: HTMLElement | null;
  children: ReactNode;
  onClose(): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const node = panel.current!;
    function position() {
      const rect = anchor?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(430, window.innerWidth - 24);
      node.style.width = `${width}px`;
      node.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
      node.style.top = `${Math.min(rect.bottom + 6, Math.max(52, window.innerHeight - node.offsetHeight - 12))}px`;
    }
    node.showPopover?.();
    position();
    node.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('resize', position);
      node.hidePopover?.();
      if (!document.activeElement?.isConnected || document.activeElement === document.body)
        anchor?.focus();
    };
  }, [anchor]);
  return (
    <div
      ref={panel}
      popover="auto"
      className="format-panel"
      role="dialog"
      aria-label="编辑格式"
      onToggle={(event) => {
        if (event.newState === 'closed') close.current();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          anchor?.focus();
        }
      }}
    >
      {children}
    </div>
  );
}
