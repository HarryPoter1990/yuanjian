import { useState } from 'react';
import type { HeadingLevel } from '../editor/types';
import { Check, ChevronDown } from '../ui/icons';
import { DropdownMenu, IconButton } from './Controls';
export function HeadingMenu({
  level,
  onChoose,
}: {
  level: HeadingLevel;
  onChoose(level: HeadingLevel): void;
}) {
  const [open, setOpen] = useState(false);
  const labels = [
    '正文',
    'H1 一级标题',
    'H2 二级标题',
    'H3 三级标题',
    'H4 四级标题',
    'H5 五级标题',
    'H6 六级标题',
  ];
  return (
    <div className="menu-anchor heading-menu">
      <IconButton
        label="标题"
        title={`当前：${labels[level]}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{level ? `H${level}` : '正文'}</span>
        <ChevronDown size={12} />
      </IconButton>
      {open && (
        <DropdownMenu label="标题级别" onClose={() => setOpen(false)}>
          {labels.map((label, value) => (
            <button
              role="menuitem"
              key={value}
              aria-current={value === level ? 'true' : undefined}
              onClick={() => {
                setOpen(false);
                onChoose(value as HeadingLevel);
              }}
            >
              <span>{label}</span>
              {value === level && <Check size={14} />}
            </button>
          ))}
        </DropdownMenu>
      )}
    </div>
  );
}
