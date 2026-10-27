import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Hash,
  Plus,
  Search,
  X,
} from '../ui/icons';
import type { FileEntry, NoteMeta, TabState, Settings } from '../shared/types';
import { dateKey, errorText, fileName } from '../ui/model';
import { DropdownMenu, Empty, IconButton, tabListKeys } from './Controls';

import { NoteSearch } from './NoteSearch';
type View = 'files' | 'recent' | 'search' | 'tags' | 'calendar';
interface Props {
  hidden?: boolean;
  tabs?: TabState[];
  onActivate?(id: string, line: number): void;
  settings: Settings;
  trees: Record<string, FileEntry[]>;
  index: NoteMeta[];
  activePath: string | null;
  onSettings(settings: Settings): void;
  onOpen(path: string, line?: number): void;
  onNew(): void;
  onJournal(
    kind: 'daily' | 'weekly' | 'monthly',
    date: string,
    templateId?: string,
    createAdditional?: boolean,
  ): void;
  onError(message: string): void;
}
export function Sidebar({
  hidden = false,
  tabs = [],
  onActivate,
  settings,
  trees,
  index,
  activePath,
  onSettings,
  onOpen,
  onNew,
  onJournal,
  onError,
}: Props) {
  const [view, setView] = useState<View>('files');
  const [moreOpen, setMoreOpen] = useState(false);
  const selectedTab = tabs.find((tab) => tab.path === activePath);
  const excerpt = useMemo(
    () =>
      selectedTab?.content
        .slice(0, 1600)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !/^(?:#|---|```|>|\|)/.test(line))
        ?.slice(0, 80) ?? '',
    [selectedTab?.content],
  );
  const recentIndex = useMemo(
    () => [...index].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 30),
    [index],
  );
  const tabMetadataKey = tabs
    .map((tab) => [tab.path, tab.title, tab.modifiedAt].join('\0'))
    .join('\n');
  const recentNotes = useMemo(() => {
    const notes = new Map(
      recentIndex.map((note) => [
        note.path,
        { path: note.path, title: note.title, modifiedAt: note.modifiedAt },
      ]),
    );
    for (const tab of tabs)
      if (tab.path)
        notes.set(tab.path, { path: tab.path, title: tab.title, modifiedAt: tab.modifiedAt });
    return [...notes.values()].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 30);
  }, [recentIndex, tabMetadataKey]);
  const [focusVersion, setFocusVersion] = useState(0);
  const [tag, setTag] = useState('');
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(dateKey(new Date()));
  const tags = Array.from(new Set(index.flatMap((note) => note.tags))).sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
  useEffect(() => {
    const focus = () => {
      setView('search');
      setFocusVersion((value) => value + 1);
    };
    window.addEventListener('yuanjian:focus-search', focus);
    return () => window.removeEventListener('yuanjian:focus-search', focus);
  }, []);
  async function addDirectory() {
    try {
      const path = await window.notes.selectDirectory();
      if (path && !settings.roots.includes(path))
        onSettings({ ...settings, roots: [...settings.roots, path] });
    } catch (error) {
      onError(errorText(error));
    }
  }
  const collapsed = new Set(settings.treeCollapsed ?? []);
  function toggleDirectory(path: string) {
    const next = new Set(collapsed);
    next.has(path) ? next.delete(path) : next.add(path);
    onSettings({ ...settings, treeCollapsed: [...next] });
  }
  function locateCurrent() {
    if (!activePath) return;
    const ancestors: string[] = [];
    const find = (entries: FileEntry[], parents: string[]): boolean =>
      entries.some((entry) => {
        if (entry.path === activePath) {
          ancestors.push(...parents);
          return true;
        }
        return entry.children ? find(entry.children, [...parents, entry.path]) : false;
      });
    if (!Object.values(trees).some((entries) => find(entries, []))) {
      onError('当前笔记不在已添加的目录中，可先添加所在目录。');
      return;
    }
    onSettings({
      ...settings,
      treeCollapsed: [...collapsed].filter((path) => !ancestors.includes(path)),
    });
    setView('files');
    requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-tree-path]')].find(
        (row) => row.dataset.treePath === activePath,
      );
      row?.focus();
      row?.scrollIntoView?.({ block: 'nearest' });
    });
  }
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const selectedNotes = index.filter((note) => fileName(note.path).includes(selected));
  return (
    <aside className="sidebar left-sidebar" aria-label="笔记导航" hidden={hidden}>
      <button
        className="sidebar-search-trigger"
        onClick={() => {
          setView('search');
          setFocusVersion((value) => value + 1);
        }}
      >
        <Search size={15} />
        <span>搜索笔记</span>
      </button>
      <div className="sidebar-switch" role="tablist" aria-label="导航类型" onKeyDown={tabListKeys}>
        {(
          [
            ['files', Folder, '文件'],
            ['recent', FileText, '最近'],
            ['search', Search, '搜索'],
            ['tags', Hash, '标签'],
            ['calendar', CalendarDays, '日历'],
          ] as const
        )
          .filter(([key]) => key === 'files' || key === 'recent' || key === view)
          .map(([key, Icon, label]) => (
            <button
              key={key}
              role="tab"
              id={`sidebar-tab-${key}`}
              aria-controls="sidebar-panel"
              aria-selected={view === key}
              tabIndex={view === key ? 0 : -1}
              title={label}
              onClick={(event) => {
                setView(key);
                setFocusVersion(key === 'search' && event.detail > 0 ? focusVersion + 1 : 0);
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        <div className="menu-anchor navigation-more">
          <IconButton
            label="更多导航"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <ChevronDown size={14} />
          </IconButton>
          {moreOpen && (
            <DropdownMenu label="更多导航" onClose={() => setMoreOpen(false)}>
              {(
                [
                  ['search', '搜索'],
                  ['tags', '标签'],
                  ['calendar', '日历'],
                ] as const
              ).map(([key, label]) => (
                <button
                  role="menuitem"
                  key={key}
                  onClick={() => {
                    setMoreOpen(false);
                    setView(key);
                    if (key === 'search') setFocusVersion((value) => value + 1);
                  }}
                >
                  {label}
                </button>
              ))}
            </DropdownMenu>
          )}
        </div>
      </div>
      <div className="sidebar-heading">
        <span>
          {
            {
              files: '文件目录',
              recent: '最近修改',
              search: '搜索笔记',
              tags: '全部标签',
              calendar: '周期笔记',
            }[view]
          }
        </span>
        <div>
          {view === 'files' && (
            <>
              <IconButton label="添加目录" onClick={() => void addDirectory()}>
                <FolderPlus size={16} />
              </IconButton>
              <IconButton label="新建笔记" onClick={onNew}>
                <Plus size={16} />
              </IconButton>
              <IconButton label="定位当前笔记" disabled={!activePath} onClick={locateCurrent}>
                <FileText size={16} />
              </IconButton>
            </>
          )}
        </div>
      </div>
      <div
        className="sidebar-body"
        id="sidebar-panel"
        role="tabpanel"
        aria-labelledby={`sidebar-tab-${view}`}
      >
        {
          <div hidden={view !== 'files'}>
            {settings.roots.length === 0 && (
              <div className="sidebar-welcome">
                <FolderPlus size={25} />
                <p>
                  从一个文件夹开始整理，
                  <br />
                  也可以直接打开任意笔记。
                </p>
                <button onClick={() => void addDirectory()}>添加文件夹</button>
              </div>
            )}
            {settings.roots.map((root) => (
              <section className="root-section" key={root}>
                <div className="root-heading">
                  <Folder size={14} />
                  <span title={root}>{fileName(root)}</span>
                  <IconButton
                    label={`移除目录入口 ${fileName(root)}`}
                    onClick={() =>
                      onSettings({
                        ...settings,
                        roots: settings.roots.filter((path) => path !== root),
                      })
                    }
                  >
                    <X size={13} />
                  </IconButton>
                </div>
                {trees[root] ? (
                  <FileTree
                    entries={trees[root]}
                    collapsed={collapsed}
                    onToggle={toggleDirectory}
                    activePath={activePath}
                    excerpt={excerpt}
                    onOpen={onOpen}
                    onError={onError}
                  />
                ) : (
                  <p className="subtle">正在读取目录…</p>
                )}
              </section>
            ))}
          </div>
        }
        {view === 'recent' && (
          <div className="recent-note-list">
            <p className="subtle">按修改时间排列，包含目录外已打开的文件。</p>
            {recentNotes.map((note) => (
              <button
                className={`note-row ${note.path === activePath ? 'active' : ''}`}
                key={note.path}
                onClick={() => onOpen(note.path)}
              >
                <FileText size={15} />
                <span>
                  <strong>{note.title}</strong>
                  <small title={note.path}>{note.path.split(/[\\/]/).slice(-2).join(' / ')}</small>
                </span>
              </button>
            ))}
            {!recentNotes.length && <Empty>打开或添加笔记后，可在这里查看最近修改的文件。</Empty>}
          </div>
        )}
        {view === 'search' && (
          <NoteSearch
            roots={settings.roots}
            tabs={tabs}
            revision={index}
            focusVersion={focusVersion}
            onOpen={onOpen}
            onActivate={onActivate}
          />
        )}
        {view === 'tags' && (
          <>
            <div className="tag-list">
              {tags.map((item) => (
                <button
                  className={tag === item ? 'tag active' : 'tag'}
                  key={item}
                  onClick={() => setTag(tag === item ? '' : item)}
                >
                  #{item}
                  <span>{index.filter((note) => note.tags.includes(item)).length}</span>
                </button>
              ))}
            </div>
            {!tags.length && <Empty>笔记中的 #标签 和顶部 tags 属性会出现在这里。</Empty>}
            {index
              .filter((note) => tag && note.tags.includes(tag))
              .map((note) => (
                <button className="note-row" key={note.path} onClick={() => onOpen(note.path)}>
                  <FileText size={15} />
                  {note.title}
                </button>
              ))}
          </>
        )}
        {view === 'calendar' && (
          <>
            <div className="calendar-month">
              <IconButton
                label="上个月"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                <ChevronLeft size={17} />
              </IconButton>
              <strong>
                {month.getFullYear()} 年 {month.getMonth() + 1} 月
              </strong>
              <IconButton
                label="下个月"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                <ChevronRight size={17} />
              </IconButton>
            </div>
            <div className="calendar-grid">
              {'一二三四五六日'.split('').map((day) => (
                <small key={day}>{day}</small>
              ))}
              {Array.from({ length: startOffset }, (_, i) => (
                <span key={`empty-${i}`} />
              ))}
              {Array.from({ length: count }, (_, i) => {
                const day = i + 1;
                const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day));
                return (
                  <button
                    key={key}
                    className={`${selected === key ? 'selected' : ''} ${key === dateKey(new Date()) ? 'today' : ''}`}
                    onClick={() => setSelected(key)}
                  >
                    {day}
                    {index.some((note) => fileName(note.path).includes(key)) && <i />}
                  </button>
                );
              })}
            </div>
            <p className="eyebrow">{selected}</p>
            <button className="journal-create" onClick={() => onJournal('daily', selected)}>
              <Plus size={15} />
              打开 / 新建日记
            </button>
            <button
              className="journal-create"
              onClick={() => onJournal('daily', selected, undefined, true)}
            >
              <FileText size={15} />
              按模板另写一篇
            </button>
            {settings.weeklyEnabled && (
              <button className="journal-create" onClick={() => onJournal('weekly', selected)}>
                打开 / 新建周记
              </button>
            )}
            {settings.monthlyEnabled && (
              <button className="journal-create" onClick={() => onJournal('monthly', selected)}>
                打开 / 新建月记
              </button>
            )}
            {selectedNotes.map((note) => (
              <button className="note-row" key={note.path} onClick={() => onOpen(note.path)}>
                <FileText size={15} />
                {note.title}
              </button>
            ))}
            {!settings.journalDirectory && (
              <p className="subtle">第一次创建时会请你选择日记文件夹。</p>
            )}
          </>
        )}
      </div>
      <button className="sidebar-open-folder" onClick={() => void addDirectory()}>
        <FolderPlus size={14} />
        打开文件夹
      </button>
      <footer className="sidebar-footer">
        <span>{index.length} 篇笔记</span>
        <span>本地文件</span>
      </footer>
    </aside>
  );
}
function FileTree({
  entries,
  excerpt,
  activePath,
  onOpen,
  onError,
  collapsed,
  onToggle,
}: {
  entries: FileEntry[];
  excerpt: string;
  activePath: string | null;
  onOpen(path: string): void;
  onError(message: string): void;
  collapsed: Set<string>;
  onToggle(path: string): void;
}) {
  const tree = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const rows: { entry: FileEntry; depth: number; parent?: string }[] = [];
  const walk = (items: FileEntry[], depth: number, parent?: string) => {
    for (const entry of items) {
      rows.push({ entry, depth, parent });
      if (entry.children && !collapsed.has(entry.path)) walk(entry.children, depth + 1, entry.path);
    }
  };
  walk(entries, 0);
  const focus = (path: string | undefined) => {
    if (!path) return;
    setFocused(path);
    [...tree.current!.querySelectorAll<HTMLElement>('[data-tree-path]')]
      .find((row) => row.dataset.treePath === path)
      ?.focus();
  };
  const current = rows.some((row) => row.entry.path === focused)
    ? focused
    : rows.some((row) => row.entry.path === activePath)
      ? activePath
      : rows[0]?.entry.path;
  const open = (entry: FileEntry) => {
    setFocused(entry.path);
    if (entry.kind === 'directory') onToggle(entry.path);
    else if (entry.kind === 'note') onOpen(entry.path);
    else void window.notes.revealPath(entry.path).catch((error) => onError(errorText(error)));
  };
  return (
    <div ref={tree} className="file-tree" role="tree" aria-label="文件目录树">
      {rows.map(({ entry, depth, parent }, index) => (
        <button
          key={entry.path}
          role="treeitem"
          data-tree-path={entry.path}
          aria-label={entry.name}
          aria-level={depth + 1}
          aria-selected={entry.path === activePath}
          aria-expanded={entry.kind === 'directory' ? !collapsed.has(entry.path) : undefined}
          tabIndex={entry.path === current ? 0 : -1}
          className={
            'tree-row ' +
            (entry.kind === 'directory' ? 'directory ' : '') +
            (entry.path === activePath ? 'active' : '')
          }
          style={{ paddingLeft: (entry.kind === 'directory' ? 10 : 24) + depth * 14 }}
          onFocus={() => setFocused(entry.path)}
          onClick={() => open(entry)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter'].includes(
                event.key,
              )
            )
              event.preventDefault();
            else return;
            if (event.key === 'ArrowDown')
              focus(rows[Math.min(rows.length - 1, index + 1)]?.entry.path);
            if (event.key === 'ArrowUp') focus(rows[Math.max(0, index - 1)]?.entry.path);
            if (event.key === 'Home') focus(rows[0]?.entry.path);
            if (event.key === 'End') focus(rows.at(-1)?.entry.path);
            if (event.key === 'Enter') open(entry);
            if (event.key === 'ArrowRight' && entry.kind === 'directory') {
              if (collapsed.has(entry.path)) onToggle(entry.path);
              else if (rows[index + 1]?.parent === entry.path) focus(rows[index + 1].entry.path);
            }
            if (event.key === 'ArrowLeft') {
              if (entry.kind === 'directory' && !collapsed.has(entry.path)) onToggle(entry.path);
              else focus(parent);
            }
          }}
        >
          {entry.kind === 'directory' ? (
            <>
              <ChevronDown size={12} className={collapsed.has(entry.path) ? 'collapsed' : ''} />
              <Folder size={14} />
            </>
          ) : (
            <FileText size={14} />
          )}
          <span className="tree-label">
            {entry.name}
            {entry.path === activePath && excerpt && (
              <small className="tree-excerpt">{excerpt}</small>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
