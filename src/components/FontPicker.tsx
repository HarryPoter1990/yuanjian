import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { FontEntry } from '../shared/types';
import { Check, ChevronDown, Search } from '../ui/icons';
import { fontChoices, fontGroups, fontSources, type FontChoice } from './font-options';
import './fonts.css';

export function FontPicker({
  label,
  value,
  fonts,
  onChange,
}: {
  label: string;
  value: string;
  fonts: FontEntry[];
  onChange(value: string): void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [systemOpen, setSystemOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [position, setPosition] = useState<CSSProperties>({});
  const choices = useMemo(() => fontChoices(fonts), [fonts]);
  const selected: FontChoice = choices.find((font) => font.name === value) ?? {
    name: value,
    group: 'system',
    sources: [],
  };
  const term = query.trim().toLocaleLowerCase();
  const matches = (font: FontChoice) => font.name.toLocaleLowerCase().includes(term);
  const groups = [
    { id: 'current', label: '当前使用', items: matches(selected) ? [selected] : [] },
    ...fontGroups.map((group) => ({
      ...group,
      items: choices.filter(
        (font) =>
          font.name !== value &&
          font.group === group.id &&
          matches(font) &&
          (group.id !== 'system' || systemOpen || term),
      ),
    })),
  ];
  const visible = groups.flatMap((group) => group.items);
  const activeIndex = visible.findIndex((font) => font.name === active);
  const optionId = (index: number) => `${id}-option-${index}`;
  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current!;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upward = below < 280 && above > below;
      const width = Math.min(Math.max(rect.width, 320), innerWidth - 24);
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        top: upward ? 'auto' : rect.bottom + 8,
        bottom: upward ? innerHeight - rect.top + 8 : 'auto',
        maxHeight: Math.max(100, Math.min(420, upward ? above : below)),
      });
    };
    // Native top-layer popover avoids clipping while staying inside the modal's focus scope.
    element.showPopover?.();
    place();
    search.current?.focus({ preventScroll: true });
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node && element.contains(event.target))) place();
    };
    window.addEventListener('resize', place);
    document.addEventListener('scroll', scroll, true);
    return () => {
      element.hidePopover?.();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (open && activeIndex < 0) setActive(visible[0]?.name ?? '');
  }, [open, activeIndex, visible[0]?.name]);
  useEffect(() => {
    if (open && activeIndex >= 0)
      document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);
  function choose(font: FontChoice) {
    onChange(font.name);
    close(true);
  }
  return (
    <>
      <button
        type="button"
        className="font-picker-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        title={value}
        ref={trigger}
        onClick={() => {
          if (open) close(true);
          else {
            setQuery('');
            setSystemOpen(false);
            setActive(value);
            setOpen(true);
          }
        }}
      >
        <span>{value}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          className="font-picker-panel"
          role="dialog"
          aria-label={`选择${label}`}
          popover="auto"
          style={position}
          onToggle={(event) => {
            if ((event.nativeEvent as ToggleEvent).newState === 'closed') setOpen(false);
          }}
          onBlurCapture={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              !event.currentTarget.contains(event.relatedTarget)
            )
              close(false);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            }
          }}
        >
          <div className="input-with-icon">
            <Search size={14} />
            <input
              ref={search}
              type="search"
              role="combobox"
              aria-label={`搜索${label}`}
              placeholder="搜索全部字体…"
              value={query}
              autoComplete="off"
              aria-expanded="true"
              aria-controls={`${id}-options`}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                  event.preventDefault();
                  if (visible.length)
                    setActive(
                      visible[
                        (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) %
                          visible.length
                      ].name,
                    );
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (visible[activeIndex]) choose(visible[activeIndex]);
                }
              }}
            />
          </div>
          <div
            className="font-picker-options"
            id={`${id}-options`}
            role="listbox"
            aria-label={`${label}选项`}
          >
            {groups.map(
              (group) =>
                group.items.length > 0 && (
                  <div role="group" aria-label={group.label} key={group.id}>
                    <div className="font-option-group">{group.label}</div>
                    {group.items.map((font) => {
                      const index = visible.indexOf(font);
                      return (
                        <div
                          role="option"
                          id={optionId(index)}
                          key={font.name}
                          aria-selected={font.name === value}
                          className={`font-option${font.name === active ? ' is-active' : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose(font)}
                        >
                          <span className="font-option-name">
                            {font.name}
                            {font.name === value && <Check size={14} />}
                          </span>
                          <small>
                            {font.sources.map((source) => fontSources[source]).join(' / ') ||
                              '当前设置 · 未在列表中'}
                          </small>
                          <span
                            className="font-option-preview"
                            style={{ fontFamily: JSON.stringify(font.name) }}
                          >
                            鸢笺 Aa 0123
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ),
            )}
          </div>
          {visible.length === 0 && (
            <p className="font-group-empty" role="status">
              没有匹配的字体
            </p>
          )}
          {!term && (
            <button
              type="button"
              className="font-picker-system"
              aria-expanded={systemOpen}
              onClick={() => setSystemOpen(!systemOpen)}
            >
              {systemOpen ? '收起系统字体' : '显示全部系统字体'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
