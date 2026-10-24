import { useMemo, type RefObject } from 'react';
import type { TabState, ViewTab } from '../shared/types';
import { ChevronDown, FileText, Network, X } from '../ui/icons';
import { tabLabelId, viewKey } from '../ui/viewTabs';
import { useTabDrag } from '../ui/useTabDrag';
import { DropdownMenu, IconButton, tabListKeys } from './Controls';

interface Props {
  tabs: TabState[];
  order: ViewTab[];
  activeId: string | null;
  graphActive: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  menuOpen: boolean;
  onMenu(open: boolean): void;
  onSelect(view: ViewTab): void;
  onClose(view: ViewTab): void;
  onNew(): void;
  onReorder(order: ViewTab[]): void;
  onContext?(view: ViewTab, x: number, y: number): void;
}
export function DocumentTabs({
  tabs,
  order,
  activeId,
  graphActive,
  scroller,
  menuOpen,
  onMenu,
  onSelect,
  onClose,
  onNew,
  onReorder,
  onContext,
}: Props) {
  const drag = useTabDrag(order, scroller, onReorder);
  const notes = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const title = (view: ViewTab) =>
    view.kind === 'graph' ? '关系图谱' : notes.get(view.id)?.title || '未命名笔记';
  const selected = (view: ViewTab) =>
    view.kind === 'graph' ? graphActive : !graphActive && view.id === activeId;
  return (
    <div className="header-tab-strip">
      <div
        ref={scroller}
        className="tabs-bar"
        role="tablist"
        aria-label="打开的笔记"
        onKeyDown={tabListKeys}
      >
        {order.map((view) => {
          const tab = view.kind === 'note' ? notes.get(view.id) : null;
          if (view.kind === 'note' && !tab) return null;
          const active = selected(view);
          return (
            <div
              className={`document-tab ${active ? 'active' : ''} ${drag.marker?.key === viewKey(view) ? 'tab-dragging' : ''}`}
              key={viewKey(view)}
              data-view-key={viewKey(view)}
              onPointerDown={(event) => drag.begin(event, view)}
              onContextMenu={(event) => {
                event.preventDefault();
                onContext?.(view, event.clientX, event.clientY);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  onContext?.(view, box.left, box.bottom);
                }
              }}
              onDragStart={(event) => event.preventDefault()}
            >
              <button
                role="tab"
                id={view.kind === 'graph' ? 'document-tab-graph' : tabLabelId(view.id)}
                aria-controls="document-panel"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={tab?.path || (tab ? '未命名草稿' : '关系图谱')}
                onClick={(event) => {
                  if (drag.allowClick(event.detail)) onSelect(view);
                }}
              >
                {view.kind === 'graph' ? <Network size={14} /> : <FileText size={14} />}
                <span>{title(view)}</span>
                {tab?.dirty && <i aria-label="有未保存修改" />}
              </button>
              <IconButton
                label={view.kind === 'graph' ? '关闭关系图谱' : `关闭 ${title(view)}`}
                tabIndex={active ? 0 : -1}
                onClick={() => onClose(view)}
              >
                <X size={13} />
              </IconButton>
            </div>
          );
        })}
        {drag.marker && (
          <span
            className="tab-insertion-marker"
            aria-hidden="true"
            style={{ left: drag.marker.left }}
          />
        )}
        <IconButton label="新建笔记" onClick={onNew}>
          <span className="plus-icon">+</span>
        </IconButton>
      </div>
      <div className="menu-anchor tab-list-anchor">
        <IconButton
          label="已打开的笔记列表"
          aria-expanded={menuOpen}
          onClick={() => onMenu(!menuOpen)}
        >
          <ChevronDown size={17} />
        </IconButton>
        {menuOpen && (
          <DropdownMenu label="已打开的笔记" onClose={() => onMenu(false)}>
            {order.map((view) => {
              const tab = view.kind === 'note' ? notes.get(view.id) : null;
              return (
                <button
                  role="menuitem"
                  key={viewKey(view)}
                  onClick={() => {
                    onMenu(false);
                    onSelect(view);
                  }}
                >
                  {view.kind === 'graph' ? <Network size={14} /> : <FileText size={14} />}
                  <span>
                    <strong>
                      {title(view)}
                      {tab?.dirty ? ' · 未保存' : ''}
                    </strong>
                    {tab && <small>{tab.path || '未命名草稿'}</small>}
                  </span>
                </button>
              );
            })}
          </DropdownMenu>
        )}
      </div>
      <div className="window-drag-region" aria-hidden="true" title="拖动窗口" />
    </div>
  );
}
