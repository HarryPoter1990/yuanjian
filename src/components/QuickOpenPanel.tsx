import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { NoteMeta, TabState } from '../shared/types';
import { Modal } from './Controls';
import './quick-open.css';

export type QuickOpenTarget = { kind: 'tab'; id: string } | { kind: 'file'; path: string };
interface Result {
  key: string;
  title: string;
  path: string;
  target: QuickOpenTarget;
  open: boolean;
}
const canonical = (path: string) => path.replace(/\\/g, '/').toLocaleLowerCase();

export function QuickOpenPanel({
  tabs,
  index,
  onSelect,
  onClose,
  busy = false,
}: {
  tabs: TabState[];
  index: NoteMeta[];
  onSelect(target: QuickOpenTarget): void;
  onClose(): void;
  busy?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const results = useMemo(() => {
    const seen = new Set<string>();
    const rows: Result[] = tabs.map((tab) => {
      if (tab.path) seen.add(canonical(tab.path));
      return {
        key: `tab:${tab.id}`,
        title: tab.title,
        path: tab.path || '未保存的草稿',
        target: { kind: 'tab', id: tab.id },
        open: true,
      };
    });
    for (const note of index) {
      const path = canonical(note.path);
      if (seen.has(path)) continue;
      seen.add(path);
      rows.push({
        key: `file:${path}`,
        title: note.title,
        path: note.path,
        target: { kind: 'file', path: note.path },
        open: false,
      });
    }
    const terms = canonical(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return rows;
    return rows.filter((row) => {
      const haystack = canonical(`${row.title} ${row.path}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [tabs, index, query]);
  const visible = results.slice(0, 100);
  const selected = Math.min(active, Math.max(0, visible.length - 1));
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, query]);
  const choose = (row: Result | undefined) => {
    if (!busy && row) onSelect(row.target);
  };
  return (
    <Modal title="快速打开笔记" onClose={onClose} busy={busy} pending={false}>
      <div className="quick-open">
        <input
          ref={input}
          role="combobox"
          aria-label="按文件名或路径查找笔记"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={visible[selected] ? `${listId}-${selected}` : undefined}
          placeholder="输入文件名或路径…"
          value={query}
          disabled={busy}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (busy || composing.current || event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(
                (selected + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) %
                  (visible.length || 1),
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(visible[selected]);
            }
          }}
        />
        <p className="quick-open-hint" role="status">
          {results.length ? `${results.length} 篇匹配笔记` : '没有匹配的笔记'}
          {results.length > 100 && '，显示前 100 篇，请继续输入缩小范围'}
        </p>
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="匹配的笔记"
          className="quick-open-results"
          aria-busy={busy}
        >
          {visible.map((row, position) => (
            <div
              key={row.key}
              id={`${listId}-${position}`}
              role="option"
              aria-selected={selected === position}
              aria-disabled={busy || undefined}
              className="quick-open-result"
              title={row.path}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => {
                if (!busy) setActive(position);
              }}
              onClick={() => choose(row)}
            >
              <span>
                <strong>{row.title}</strong>
                {row.open && <small>已打开</small>}
              </span>
              <span className="quick-open-path">{row.path}</span>
            </div>
          ))}
        </div>
        <p className="quick-open-hint">↑ ↓ 选择 · Enter 打开 · Esc 返回正文</p>
      </div>
    </Modal>
  );
}
