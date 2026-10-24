import { useLayoutEffect, useRef } from 'react';
import { DropdownMenu } from './Controls';
export interface TabMenuAction {
  label: string;
  disabled?: boolean;
  shortcut?: string;
  run(): void;
}
export function TabContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: TabMenuAction[];
  onClose(): void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    const menu = element?.querySelector<HTMLElement>('[role="menu"]');
    if (!element || !menu) return;
    const box = menu.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
  }, [x, y]);
  return (
    <div ref={anchor} className="tab-context-anchor" style={{ left: x, top: y }}>
      <DropdownMenu label="标签操作" onClose={onClose}>
        {actions.map((action) => (
          <button
            role="menuitem"
            key={action.label}
            disabled={action.disabled}
            onClick={() => {
              onClose();
              action.run();
            }}
          >
            <span>{action.label}</span>
            {action.shortcut && <kbd>{action.shortcut}</kbd>}
          </button>
        ))}
      </DropdownMenu>
    </div>
  );
}
