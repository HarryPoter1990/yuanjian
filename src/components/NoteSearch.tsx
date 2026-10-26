import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchPage, TabState } from '../shared/types';
import { mergeOpenSearch, searchTerms } from '../shared/search';
import { errorText, fileName } from '../ui/model';
const emptyPage = (): SearchPage => ({ notes: [], issues: [], truncated: false });
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = searchTerms(query).sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  );
  return (
    <>
      {text
        .split(pattern)
        .map((part, index) =>
          terms.includes(part.toLocaleLowerCase()) ? <mark key={index}>{part}</mark> : part,
        )}
    </>
  );
}
export function NoteSearch({
  roots,
  tabs,
  revision,
  focusVersion,
  onOpen,
  onActivate,
}: {
  roots: string[];
  tabs: TabState[];
  revision: unknown;
  focusVersion: number;
  onOpen(path: string, line?: number): void;
  onActivate?(id: string, line: number): void;
}) {
  const [query, setQuery] = useState(''),
    [scope, setScope] = useState('');
  const [page, setPage] = useState<SearchPage>(emptyPage),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('');
  const [identity, setIdentity] = useState({ query: '', scope: '' });
  const [limit, setLimit] = useState(40);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusVersion) input.current?.focus();
  }, [focusVersion]);
  const rootsKey = JSON.stringify(roots);
  useEffect(() => {
    if (scope && !roots.includes(scope)) setScope('');
  }, [rootsKey, scope]);
  useEffect(() => {
    let alive = true;
    const requestId = crypto.randomUUID();
    setFailure('');
    setLimit(40);
    if (!query.trim()) {
      setPage(emptyPage());
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      void window.notes
        .searchNotes(query, { root: scope || undefined, requestId })
        .then((result) => {
          if (alive && !result.cancelled) {
            setPage(result);
            setIdentity({ query, scope });
          }
        })
        .catch((error) => {
          if (alive) {
            setPage(emptyPage());
            setIdentity({ query, scope });
            setFailure(errorText(error));
          }
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 240);
    return () => {
      alive = false;
      clearTimeout(timer);
      void window.notes.cancelSearch(requestId).catch(() => {});
    };
  }, [query, scope, rootsKey, revision]);
  const merged = useMemo(
    () =>
      mergeOpenSearch(
        identity.query === query && identity.scope === scope ? page : emptyPage(),
        query,
        tabs,
        scope,
      ),
    [page, identity, query, tabs, scope],
  );
  function open(id: string, path: string | null, line: number) {
    if (tabs.some((tab) => tab.id === id) && onActivate) onActivate(id, line);
    else if (path) onOpen(path, line);
  }
  return (
    <div className="note-search">
      <input
        ref={input}
        className="sidebar-search-input"
        aria-label="跨文件搜索"
        placeholder="搜索笔记"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        aria-label="搜索目录范围"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
      >
        <option value="">全部目录与打开的笔记</option>
        {roots.map((root) => (
          <option key={root} value={root}>
            {fileName(root)}
          </option>
        ))}
      </select>
      <p className="subtle">空格分词；“双引号”内精确查找。未保存内容也参与搜索。</p>
      {busy && <p role="status">正在搜索…</p>}
      {failure && (
        <p role="alert" className="inline-error">
          {failure}
        </p>
      )}
      {query.trim() && !busy && (
        <p role="status">
          {merged.notes.length} 篇匹配笔记{merged.truncated ? '（结果达到上限，请缩小范围）' : ''}
        </p>
      )}
      {merged.issues.length > 0 && (
        <details className="inline-error">
          <summary>有 {merged.issues.length} 个位置未能搜索，结果不完整</summary>
          {merged.issues.map((issue, i) => (
            <p key={i}>
              {issue.path}：{issue.message}
            </p>
          ))}
        </details>
      )}
      {merged.notes.slice(0, limit).map((note) => (
        <section key={note.id} className="search-note">
          <button
            className="search-result"
            title={note.path ?? '未保存草稿'}
            onClick={() => open(note.id, note.path, note.matches[0]?.line ?? 1)}
          >
            <strong>
              <Highlight text={note.title} query={query} />
              {(note.dirty || !note.path) && <small>未保存</small>}
            </strong>
            <small>
              {note.path ?? '未保存草稿'} · {note.matchCount} 处正文匹配
            </small>
          </button>
          {note.matches.slice(0, 1).map((match) => (
            <button
              className="search-result"
              key={match.line}
              onClick={() => open(note.id, note.path, match.line)}
            >
              <small>第 {match.line} 行</small>
              <span>
                <Highlight text={match.snippet} query={query} />
              </span>
            </button>
          ))}
          {note.matches.length > 1 && (
            <details>
              <summary>展开其余 {note.matches.length - 1} 处命中</summary>
              {note.matches.slice(1).map((match) => (
                <button
                  className="search-result"
                  key={match.line}
                  onClick={() => open(note.id, note.path, match.line)}
                >
                  <small>第 {match.line} 行</small>
                  <span>
                    <Highlight text={match.snippet} query={query} />
                  </span>
                </button>
              ))}
            </details>
          )}
          {note.matchCount > note.matches.length && (
            <p className="subtle">
              已列出前 {note.matches.length} 行命中，共 {note.matchCount} 行；可打开笔记继续查找。
            </p>
          )}
        </section>
      ))}
      {merged.notes.length > limit && (
        <button onClick={() => setLimit((value) => value + 40)}>
          显示更多笔记（剩余 {merged.notes.length - limit} 篇）
        </button>
      )}
    </div>
  );
}
