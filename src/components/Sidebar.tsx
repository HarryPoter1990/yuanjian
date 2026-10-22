import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import type { FileEntry, NoteMeta, SearchHit, Settings } from '../shared/types';
import { dateKey, errorText, fileName } from '../ui/model';
import { Empty, IconButton } from './Controls';

type View = 'files' | 'search' | 'tags' | 'calendar';
interface Props {
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
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [tag, setTag] = useState('');
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(dateKey(new Date()));
  const tags = Array.from(new Set(index.flatMap((note) => note.tags))).sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
  useEffect(() => {
    if (view !== 'search') return;
    let alive = true;
    setSearchError('');
    if (!query.trim()) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void window.notes
        .search(query, { root: scope || undefined })
        .then((result) => {
          if (alive) setHits(result);
        })
        .catch((error) => {
          if (alive) setSearchError(errorText(error));
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 240);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, scope, view]);
  async function addDirectory() {
    try {
      const path = await window.notes.selectDirectory();
      if (path && !settings.roots.includes(path))
        onSettings({ ...settings, roots: [...settings.roots, path] });
    } catch (error) {
      onError(errorText(error));
    }
  }
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const selectedNotes = index.filter((note) => fileName(note.path).includes(selected));
  return (
    <aside className="sidebar left-sidebar" aria-label="笔记导航">
      <div className="sidebar-switch" role="tablist" aria-label="导航类型">
        {(
          [
            ['files', Folder, '文件'],
            ['search', Search, '搜索'],
            ['tags', Hash, '标签'],
            ['calendar', CalendarDays, '日历'],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            title={label}
            onClick={() => setView(key)}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-heading">
        <span>
          {{ files: '文件目录', search: '搜索笔记', tags: '全部标签', calendar: '周期笔记' }[view]}
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
            </>
          )}
        </div>
      </div>
      <div className="sidebar-body">
        {view === 'files' && (
          <>
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
                    activePath={activePath}
                    onOpen={onOpen}
                    onError={onError}
                  />
                ) : (
                  <p className="subtle">正在读取目录…</p>
                )}
              </section>
            ))}
          </>
        )}
        {view === 'search' && (
          <>
            <div className="input-with-icon">
              <Search size={15} />
              <input
                autoFocus
                aria-label="跨文件搜索"
                placeholder="搜索已添加目录…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              aria-label="搜索目录范围"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="">全部已添加目录</option>
              {settings.roots.map((root) => (
                <option key={root} value={root}>
                  {fileName(root)}
                </option>
              ))}
            </select>
            {searching && (
              <p className="subtle" role="status">
                正在搜索…
              </p>
            )}
            {searchError && (
              <p className="inline-error" role="alert">
                {searchError}
              </p>
            )}
            {!searching && query && !hits.length && !searchError && (
              <Empty>没有找到匹配内容。</Empty>
            )}
            {hits.map((hit, i) => (
              <button
                className="search-result"
                key={`${hit.path}:${hit.line}:${i}`}
                onClick={() => onOpen(hit.path, hit.line)}
              >
                <strong>
                  {hit.title}
                  <small>第 {hit.line} 行</small>
                </strong>
                <span>{hit.snippet}</span>
                <small>{fileName(hit.path)}</small>
              </button>
            ))}
          </>
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
      <footer className="sidebar-footer">
        <span>{index.length} 篇笔记</span>
        <span>本地文件</span>
      </footer>
    </aside>
  );
}
function FileTree({
  entries,
  activePath,
  onOpen,
  onError,
  depth = 0,
}: {
  entries: FileEntry[];
  activePath: string | null;
  onOpen(path: string): void;
  onError(message: string): void;
  depth?: number;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  return (
    <div className="file-tree">
      {entries.map((entry) =>
        entry.kind === 'directory' ? (
          <div key={entry.path}>
            <button
              className="tree-row directory"
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() =>
                setClosed((current) => {
                  const next = new Set(current);
                  next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path);
                  return next;
                })
              }
              aria-expanded={!closed.has(entry.path)}
            >
              <ChevronDown size={12} className={closed.has(entry.path) ? 'collapsed' : ''} />
              <Folder size={14} />
              <span>{entry.name}</span>
            </button>
            {!closed.has(entry.path) && (
              <FileTree
                entries={entry.children || []}
                activePath={activePath}
                onOpen={onOpen}
                onError={onError}
                depth={depth + 1}
              />
            )}
          </div>
        ) : (
          <button
            key={entry.path}
            className={`tree-row ${entry.path === activePath ? 'active' : ''}`}
            style={{ paddingLeft: 24 + depth * 14 }}
            onClick={() =>
              entry.kind === 'note'
                ? onOpen(entry.path)
                : void window.notes
                    .revealPath(entry.path)
                    .catch((error) => onError(errorText(error)))
            }
          >
            <FileText size={14} />
            <span>{entry.name}</span>
          </button>
        ),
      )}
    </div>
  );
}
