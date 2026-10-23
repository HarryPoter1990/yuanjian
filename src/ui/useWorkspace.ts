import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Bootstrap,
  FileEntry,
  NoteDocument,
  NoteMeta,
  OperationProgress,
  SaveOutcome,
  SessionState,
  Settings,
  TabState,
} from '../shared/types';
import { acceptSave, asTab, errorText, makeDraft } from './model';

export interface Notice {
  id: string;
  message: string;
  error?: boolean;
  action?: { label: string; run(): void };
}
export interface Conflict {
  tabId: string;
  detail: NonNullable<SaveOutcome['conflict']>;
}
export function useWorkspace() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [index, setIndex] = useState<NoteMeta[]>([]);
  const [trees, setTrees] = useState<Record<string, FileEntry[]>>({});
  const [notices, setNotices] = useState<Notice[]>([]);
  const [saving, setSaving] = useState<string[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [settingsState, setSettingsState] = useState('设置已保存');
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [closing, setClosing] = useState(false);
  const current = useRef({ tabs, activeId, settings, conflict });
  current.current = { tabs, activeId, settings, conflict };
  const pendingSaves = useRef(new Map<string, Promise<boolean>>());
  const externalReads = useRef(new Map<string, symbol>());
  const savedSettings = useRef('');
  const sessionWrite = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const notify = useCallback((message: string, error = false, action?: Notice['action']) => {
    setNotices((previous) => [
      ...previous.slice(-3),
      { id: crypto.randomUUID(), message, error, action },
    ]);
  }, []);
  const updateTab = useCallback(
    (id: string, update: Partial<TabState> | ((tab: TabState) => TabState)) => {
      const next = current.current.tabs.map((tab) =>
        tab.id === id
          ? { ...(typeof update === 'function' ? update(tab) : { ...tab, ...update }), id: tab.id }
          : tab,
      );
      current.current.tabs = next;
      setTabs(next);
    },
    [],
  );
  const persistSession = useCallback(async () => {
    const value: SessionState = { tabs: current.current.tabs, activeId: current.current.activeId };
    const write = sessionWrite.current
      .catch(() => undefined)
      .then(() => window.notes.saveSession(value));
    sessionWrite.current = write;
    await write;
  }, []);
  const refresh = useCallback(async () => {
    const config = current.current.settings;
    if (!config) return;
    const [notes, ...entries] = await Promise.all([
      window.notes.getIndex(),
      ...config.roots.map((root) => window.notes.getTree(root)),
    ]);
    if (!mounted.current) return;
    setIndex(notes);
    setTrees(Object.fromEntries(config.roots.map((root, i) => [root, entries[i]])));
  }, []);
  const openDocument = useCallback((note: NoteDocument) => {
    const existing = current.current.tabs.find((tab) => tab.path && tab.path === note.path);
    if (existing) {
      setActiveId(existing.id);
      return existing.id;
    }
    const tab = asTab(note);
    const next = [...current.current.tabs, tab];
    current.current.tabs = next;
    setTabs(next);
    setActiveId(tab.id);
    return tab.id;
  }, []);
  const open = useCallback(
    async (path?: string) => {
      if (path) {
        const existing = current.current.tabs.find((tab) => tab.path === path);
        if (existing) {
          setActiveId(existing.id);
          return existing.id;
        }
      }
      try {
        const note = await window.notes.openFile(path);
        return note ? openDocument(note) : null;
      } catch (error) {
        notify(`打开失败：${errorText(error)}`, true);
        return null;
      }
    },
    [notify, openDocument],
  );
  const newDraft = useCallback((content = '', title = '未命名笔记') => {
    const tab = makeDraft(content, title);
    const next = [...current.current.tabs, tab];
    current.current.tabs = next;
    setTabs(next);
    setActiveId(tab.id);
    return tab.id;
  }, []);
  const save = useCallback(
    (id: string, explicit = false): Promise<boolean> => {
      const flushLatest = (pending: Promise<boolean>): Promise<boolean> =>
        explicit
          ? pending.then((saved) => {
              const latest = current.current.tabs.find((item) => item.id === id);
              return saved && latest?.dirty ? save(id, true) : saved;
            })
          : pending;
      const inflight = pendingSaves.current.get(id);
      if (inflight) return flushLatest(inflight);
      const tab = current.current.tabs.find((item) => item.id === id);
      if (!tab || current.current.conflict?.tabId === id) return Promise.resolve(false);
      if (!explicit && (!tab.path || !tab.dirty)) return Promise.resolve(true);
      const task = (async () => {
        setSaving((previous) => [...previous, id]);
        try {
          const outcome = await window.notes.saveFile({
            path: tab.path,
            content: tab.content,
            baseContent: tab.baseContent,
            hash: tab.hash,
            title: tab.title,
          });
          if (outcome.status === 'conflict' && outcome.conflict) {
            const latest = current.current.tabs.find((item) => item.id === id);
            const next = {
              tabId: id,
              detail: { ...outcome.conflict, ours: latest?.content ?? outcome.conflict.ours },
            };
            current.current.conflict = next;
            setConflict(next);
            notify('文件在外部发生了不同修改，请比较后保留内容。', true);
            return false;
          }
          if (outcome.status !== 'saved') return false;
          const latest = current.current.tabs.find((item) => item.id === id);
          if (!latest) return true;
          const accepted = acceptSave(latest, tab.content, outcome);
          updateTab(id, accepted.tab);
          if (accepted.conflict) {
            const next = { tabId: id, detail: accepted.conflict };
            current.current.conflict = next;
            setConflict(next);
            notify('保存期间的新输入与合并结果冲突，双方内容已保留，请比较后处理。', true);
            return false;
          }
          if (explicit) notify(outcome.merged ? '已合并外部修改并保存' : '已保存');
          void refresh().catch((error) => notify(errorText(error), true));
          return true;
        } catch (error) {
          notify(`保存失败，内容仍保留在编辑器：${errorText(error)}`, true);
          return false;
        } finally {
          pendingSaves.current.delete(id);
          setSaving((previous) => previous.filter((value) => value !== id));
        }
      })();
      pendingSaves.current.set(id, task);
      return flushLatest(task);
    },
    [notify, refresh, updateTab],
  );
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    mounted.current = true;
    if (!window.notes) {
      setLoadError('桌面连接不可用。请从鸢笺桌面程序启动。');
      return;
    }
    let alive = true;
    void window.notes
      .bootstrap()
      .then(async (value) => {
        const failures: string[] = [];
        const restored = value.session.tabs.length
          ? await Promise.all(
              value.session.tabs.map(async (tab) => {
                if (!tab.path || tab.dirty) return tab;
                try {
                  const note = await window.notes.openFile(tab.path);
                  if (!note) throw new Error('文件未能读取');
                  return { ...tab, ...note, id: tab.id, baseContent: note.content, dirty: false };
                } catch (error) {
                  failures.push(
                    `恢复时未能刷新「${tab.title}」，已保留会话原文：${errorText(error)}`,
                  );
                  return tab;
                }
              }),
            )
          : [makeDraft()];
        if (!alive) return;
        setSettings(value.settings);
        savedSettings.current = JSON.stringify(value.settings);
        setTabs(restored);
        setActiveId(
          restored.some((tab) => tab.id === value.session.activeId)
            ? value.session.activeId
            : restored[0].id,
        );
        setBootstrap({ ...value, session: { ...value.session, tabs: restored } });
        for (const failure of failures) notify(failure, true);
      })
      .catch((error) => {
        if (alive) setLoadError(errorText(error));
      });
    return () => {
      alive = false;
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!settings) return;
    const serialized = JSON.stringify(settings);
    if (savedSettings.current === serialized) return;
    setSettingsState('正在保存设置…');
    const timer = setTimeout(() => {
      void window.notes
        .saveSettings(settings)
        .then((value) => {
          const previous: Settings = JSON.parse(savedSettings.current);
          const indexChanged =
            JSON.stringify([previous.roots, previous.excluded, previous.showAllFiles]) !==
            JSON.stringify([value.roots, value.excluded, value.showAllFiles]);
          savedSettings.current = JSON.stringify(value);
          if (JSON.stringify(current.current.settings) === serialized) {
            setSettings(value);
            setSettingsState('设置已保存');
          }
          if (indexChanged)
            void refresh().catch((error) => notify(`刷新目录失败：${errorText(error)}`, true));
        })
        .catch((error) => {
          setSettingsState('设置保存失败');
          notify(`设置保存失败：${errorText(error)}`, true);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [settings, notify, refresh]);
  useEffect(() => {
    if (!bootstrap) return;
    const timer = setTimeout(
      () =>
        void persistSession().catch((error) =>
          notify(`草稿会话保存失败：${errorText(error)}`, true),
        ),
      450,
    );
    return () => clearTimeout(timer);
  }, [tabs, activeId, bootstrap, persistSession, notify]);
  useEffect(() => {
    if (!settings) return;
    void refresh().catch((error) => notify(`读取目录失败：${errorText(error)}`, true));
  }, [
    settings?.roots.join('|'),
    settings?.excluded.join('|'),
    settings?.showAllFiles,
    refresh,
    notify,
  ]);
  useEffect(() => {
    if (!settings?.autoSave) return;
    const timer = setTimeout(() => {
      for (const tab of current.current.tabs)
        if (tab.path && tab.dirty && current.current.conflict?.tabId !== tab.id)
          void saveRef.current(tab.id);
    }, 850);
    return () => clearTimeout(timer);
  }, [
    tabs
      .map((tab) => `${tab.id}:${tab.content}:${tab.path}:${tab.hash}:${tab.dirty}`)
      .join('\u0000'),
    settings?.autoSave,
  ]);
  useEffect(() => {
    if (!bootstrap) return;
    const cleanup = [
      window.notes.onFilesChanged((paths) => {
        void refresh().catch((error) => notify(errorText(error), true));
        for (const tab of current.current.tabs) {
          if (!tab.path || !paths.includes(tab.path)) continue;
          const readId = Symbol();
          externalReads.current.set(tab.id, readId);
          if (tab.dirty) {
            if (current.current.conflict?.tabId === tab.id) continue;
            if (current.current.settings?.autoSave) void saveRef.current(tab.id);
            else notify('文件在外部发生变化；自动保存已关闭，本地修改已保留。');
            continue;
          }
          void window.notes
            .openFile(tab.path)
            .then((note) => {
              if (note && mounted.current && externalReads.current.get(tab.id) === readId)
                updateTab(tab.id, (latest) =>
                  latest.dirty || latest.path !== tab.path || latest.hash !== tab.hash
                    ? latest
                    : { ...latest, ...note, baseContent: note.content },
                );
            })
            .catch((error) => {
              if (mounted.current && externalReads.current.get(tab.id) === readId)
                notify(`外部文件更新失败：${errorText(error)}`, true);
            })
            .finally(() => {
              if (externalReads.current.get(tab.id) === readId)
                externalReads.current.delete(tab.id);
            });
        }
      }),
      window.notes.onOpenRequested((path) => {
        void open(path);
      }),
      window.notes.onProgress((value) => setProgress(value)),
      window.notes.onCloseRequested(() => {
        if (current.current.conflict) {
          notify('请先处理保存冲突，窗口已保留。', true);
          return;
        }
        setClosing(true);
        void (async () => {
          for (const tab of current.current.tabs)
            if (tab.path && tab.dirty && !(await saveRef.current(tab.id, true))) {
              setClosing(false);
              return;
            }
          if (current.current.tabs.some((tab) => tab.path && tab.dirty)) {
            setClosing(false);
            notify('关闭前仍有未保存修改，窗口已保留。', true);
            return;
          }
          await persistSession();
          if (current.current.settings) await window.notes.saveSettings(current.current.settings);
          await window.notes.closeReady();
        })().catch((error) => {
          setClosing(false);
          notify(`关闭前保存失败，窗口已保留：${errorText(error)}`, true);
        });
      }),
    ];
    return () => cleanup.forEach((dispose) => dispose());
  }, [bootstrap, notify, open, persistSession, refresh, updateTab]);
  useEffect(() => {
    const timer = setTimeout(() => setProgress(null), 5000);
    return () => clearTimeout(timer);
  }, [progress]);
  function removeTab(id: string) {
    const previous = current.current.tabs;
    let remaining = previous.filter((tab) => tab.id !== id);
    if (!remaining.length) {
      const draft = makeDraft();
      remaining = [draft];
      setActiveId(draft.id);
    } else if (current.current.activeId === id)
      setActiveId(
        remaining[
          Math.min(
            previous.findIndex((tab) => tab.id === id),
            remaining.length - 1,
          )
        ].id,
      );
    current.current.tabs = remaining;
    setTabs(remaining);
  }
  function keepBoth() {
    if (!conflict) return;
    const { tabId, detail } = conflict;
    const ours = current.current.tabs.find((tab) => tab.id === tabId);
    if (!ours) return;
    updateTab(tabId, {
      content: detail.theirs,
      baseContent: detail.theirs,
      hash: detail.hash,
      dirty: false,
    });
    newDraft(ours.content, `${ours.title.replace(/\.md$/i, '')} · 本地保留`);
    setConflict(null);
    notify('外部文件已保留；本地内容已放入独立草稿，可另存。');
  }
  return {
    bootstrap,
    loadError,
    settings,
    setSettings,
    tabs,
    setTabs,
    activeId,
    setActiveId,
    index,
    trees,
    notices,
    setNotices,
    notify,
    saving,
    conflict,
    setConflict,
    settingsState,
    progress,
    closing,
    updateTab,
    open,
    openDocument,
    newDraft,
    save,
    refresh,
    removeTab,
    keepBoth,
    persistSession,
    getTab: (id: string) => current.current.tabs.find((tab) => tab.id === id),
  };
}
