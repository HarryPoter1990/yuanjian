import { useState } from 'react';
import type { TabState } from '../shared/types';
import { ArrowLeftRight, ChevronDown, Ellipsis, LoaderCircle, Pin } from '../ui/icons';
import { DropdownMenu, IconButton } from './Controls';

export function StickyHeader({
  active,
  tabs,
  pinned,
  pending,
  saving,
  onSelect,
  onPin,
  onFull,
  actions,
}: {
  active: TabState | null;
  tabs: TabState[];
  pinned: boolean;
  pending: boolean;
  saving: boolean;
  onSelect(id: string): void;
  onPin(): void;
  onFull(): void;
  actions: Array<{ label: string; run(): void; disabled?: boolean }>;
}) {
  const [menu, setMenu] = useState<'notes' | 'more' | null>(null);
  return (
    <header className="sticky-header" aria-label="便笺标题栏">
      <div className="sticky-drag-handle" title="按住此处拖动便笺" aria-hidden="true" />
      <div className="menu-anchor sticky-title-anchor">
        <button
          className="sticky-title"
          aria-label="切换便笺笔记"
          aria-expanded={menu === 'notes'}
          disabled={pending}
          title={active?.path || active?.title || '未命名笔记'}
          onClick={() => setMenu(menu === 'notes' ? null : 'notes')}
        >
          <span>{active?.title || '未命名笔记'}</span>
          {saving ? (
            <span role="status" aria-label="保存中">
              <LoaderCircle size={12} className="spin" />
            </span>
          ) : (
            active?.dirty && <i aria-label="有未保存修改" />
          )}
          <ChevronDown size={12} />
        </button>
        {menu === 'notes' && (
          <DropdownMenu label="便笺笔记" onClose={() => setMenu(null)}>
            {tabs.map((tab) => (
              <button
                role="menuitem"
                key={tab.id}
                onClick={() => {
                  setMenu(null);
                  onSelect(tab.id);
                }}
              >
                <span>
                  <strong>
                    {tab.title}
                    {tab.dirty ? ' · 未保存' : ''}
                  </strong>
                  <small>{tab.path || '未命名草稿'}</small>
                </span>
              </button>
            ))}
          </DropdownMenu>
        )}
      </div>
      <IconButton label="便笺始终置顶" aria-pressed={pinned} disabled={pending} onClick={onPin}>
        <Pin size={15} />
      </IconButton>
      <IconButton label="返回完整窗口" disabled={pending} onClick={onFull}>
        <ArrowLeftRight size={15} />
      </IconButton>
      <div className="menu-anchor sticky-more-anchor">
        <IconButton
          label="便笺更多操作"
          aria-expanded={menu === 'more'}
          disabled={pending}
          onClick={() => setMenu(menu === 'more' ? null : 'more')}
        >
          <Ellipsis size={16} />
        </IconButton>
        {menu === 'more' && (
          <DropdownMenu label="便笺操作" onClose={() => setMenu(null)}>
            {actions.map((action) => (
              <button
                role="menuitem"
                key={action.label}
                disabled={action.disabled}
                onClick={() => {
                  setMenu(null);
                  action.run();
                }}
              >
                {action.label}
              </button>
            ))}
          </DropdownMenu>
        )}
      </div>
      <div className="sticky-native-controls" aria-hidden="true" />
    </header>
  );
}
