import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlignLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  Bold,
  Check,
  ChevronDown,
  Code2,
  Columns2,
  Ellipsis,
  FilePlus2,
  FileText,
  FolderOpen,
  Hash,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  LoaderCircle,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Quote,
  Redo2,
  Save,
  Search,
  Settings,
  Sigma,
  Table2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  FontEntry,
  NoteMeta,
  Settings as AppSettings,
  TabState,
  Template,
} from './shared/types';
import { extractHeadings, extractLinks, extractTags, setFrontmatterTags } from './shared/markdown';
import { MarkdownEditor } from './editor/MarkdownEditor';
import type { EditorCommand, MarkdownEditorHandle } from './editor/types';
import { hydrateMarkdown, renderMarkdown } from './editor/renderer';
import { IconButton, Modal, OperationContext } from './components/Controls';
import { Sidebar } from './components/Sidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { GraphView } from './components/GraphView';
import { LinkPanel } from './components/LinkPanel';
import { AttachmentPanel, HistoryPanel } from './components/RecoveryPanels';
import { useWorkspace } from './ui/useWorkspace';
import { validateExportContent } from './ui/exportValidation';
import { exportCanvasStyle } from './ui/exportStyle';
import {
  appearanceColors,
  dateKey,
  errorText,
  fileName,
  markdownLink,
  matchesShortcut,
} from './ui/model';

type Panel =
  | 'settings'
  | 'new'
  | 'history'
  | 'attachments'
  | 'move'
  | 'delete'
  | 'preview'
  | 'close'
  | 'localize'
  | 'link'
  | null;
const buttons: { id: EditorCommand | 'image'; title: string; icon: typeof Bold }[] = [
  { id: 'heading', title: '标题', icon: Hash },
  { id: 'bold', title: '粗体', icon: Bold },
  { id: 'italic', title: '斜体', icon: Italic },
  { id: 'list', title: '列表', icon: List },
  { id: 'task', title: '任务列表', icon: ListChecks },
  { id: 'quote', title: '引用', icon: Quote },
  { id: 'code', title: '代码块', icon: Code2 },
  { id: 'math', title: '公式', icon: Sigma },
  { id: 'table', title: '表格', icon: Table2 },
  { id: 'link', title: '链接', icon: Link2 },
  { id: 'image', title: '插入图片', icon: ImagePlus },
  { id: 'diagram', title: '流程图', icon: Network },
];
export default function App() {
  const workspace = useWorkspace();
  const { settings, tabs, activeId, notify, updateTab } = workspace;
  const active = tabs.find((tab) => tab.id === activeId) || null;
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphActive, setGraphActive] = useState(false);
  const [fonts, setFonts] = useState<FontEntry[]>([]);
  const [wallpaperUrl, setWallpaperUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [exportTheme, setExportTheme] = useState(false);
  const [exportWallpaper, setExportWallpaper] = useState(false);
  const [localizeTarget, setLocalizeTarget] = useState('');
  const [linkRequest, setLinkRequest] = useState<{
    tabId: string;
    sourcePath: string | null;
    content: string;
    from: number;
    to: number;
    label: string;
  } | null>(null);
  const [movePath, setMovePath] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [backlinks, setBacklinks] = useState<NoteMeta[]>([]);
  const [pendingLine, setPendingLine] = useState<{ id: string; line: number } | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [journalChoice, setJournalChoice] = useState<{
    kind: 'daily' | 'weekly' | 'monthly';
    date: string;
    createAdditional?: boolean;
  } | null>(null);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const editor = useRef<MarkdownEditorHandle>(null);
  const preview = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const loadedFonts = useRef(new Map<string, FontFace | null>());
  const activeRef = useRef(active);
  activeRef.current = active;
  const error = useCallback((message: string) => notify(message, true), [notify]);
  const headings = useMemo(() => extractHeadings(active?.content || ''), [active?.content]);
  const tags = useMemo(() => extractTags(active?.content || ''), [active?.content]);
  const remoteImages = useMemo(
    () => [
      ...new Set(
        extractLinks(active?.content || '')
          .filter((link) => link.image && /^https?:\/\//i.test(link.target))
          .map((link) => link.target),
      ),
    ],
    [active?.content],
  );
  useEffect(() => {
    if (workspace.bootstrap) {
      setFonts(workspace.bootstrap.fonts);
      for (const warning of workspace.bootstrap.warnings || []) notify(warning, true);
    }
  }, [workspace.bootstrap, notify]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setSystemDark(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    let alive = true;
    const path = settings?.appearance.wallpaper;
    if (!path) {
      setWallpaperUrl('');
      return;
    }
    void window.notes
      .assetUrl(path)
      .then((url) => {
        if (alive) setWallpaperUrl(url);
      })
      .catch((reason) => error(`壁纸读取失败：${errorText(reason)}`));
    return () => {
      alive = false;
    };
  }, [settings?.appearance.wallpaper, error]);
  useEffect(() => {
    for (const [id, face] of loadedFonts.current)
      if (!fonts.some((font) => font.id === id)) {
        if (face) document.fonts.delete(face);
        loadedFonts.current.delete(id);
      }
    for (const font of fonts) {
      if (!font.url || loadedFonts.current.has(font.id)) continue;
      loadedFonts.current.set(font.id, null);
      void new FontFace(font.name, `url(${JSON.stringify(font.url)})`)
        .load()
        .then((face) => {
          if (loadedFonts.current.has(font.id)) {
            loadedFonts.current.set(font.id, face);
            document.fonts.add(face);
          }
        })
        .catch((reason) => {
          loadedFonts.current.delete(font.id);
          error(`字体 ${font.name} 加载失败：${errorText(reason)}`);
        });
    }
  }, [fonts, error]);
  useEffect(() => {
    setTagInput(tags.join(', '));
  }, [active?.id, tags.join('\u0000')]);
  useEffect(() => {
    let alive = true;
    if (!active?.path) {
      setBacklinks([]);
      return;
    }
    const path = active.path;
    void Promise.all(
      workspace.index
        .filter((note) => note.path !== path)
        .map(async (note) => {
          for (const link of note.links.filter((item) => !item.image)) {
            const resolved = await window.notes.resolveLink(note.path, link.target);
            if (resolved.path === path) return note;
          }
          return null;
        }),
    )
      .then((results) => {
        if (alive) setBacklinks(results.filter((note): note is NoteMeta => note !== null));
      })
      .catch((reason) => error(`反向引用读取失败：${errorText(reason)}`));
    return () => {
      alive = false;
    };
  }, [active?.path, workspace.index, error]);
  useEffect(() => {
    if (pendingLine && activeId === pendingLine.id && !graphActive) {
      const timer = setTimeout(() => {
        editor.current?.scrollToLine(pendingLine.line);
        setPendingLine(null);
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [pendingLine, activeId, graphActive]);
  const open = useCallback(
    async (path?: string, line?: number) => {
      const id = await workspace.open(path);
      if (id) {
        setGraphActive(false);
        if (line) setPendingLine({ id, line });
      }
    },
    [workspace.open],
  );
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    try {
      await action();
    } catch (reason) {
      error(`${label}失败：${errorText(reason)}`);
    } finally {
      setBusy('');
    }
  }
  async function ensureSaved(id: string): Promise<boolean> {
    const latest = workspace.getTab(id);
    if (!latest) return false;
    if (latest.dirty && !(await workspace.save(id, true))) return false;
    if (workspace.getTab(id)?.dirty) {
      error('当前仍有未保存修改，操作已停止，正文仍保留。');
      return false;
    }
    return true;
  }
  const changeSettings = (value: AppSettings) => workspace.setSettings(value);
  function beginLink() {
    const view = editor.current?.getView();
    if (!active || !view) {
      error('编辑器尚未准备好，请稍后重试。');
      return;
    }
    const { from, to } = view.state.selection.main;
    setLinkRequest({
      tabId: active.id,
      sourcePath: active.path,
      content: active.content,
      from,
      to,
      label: view.state.sliceDoc(from, to),
    });
    setPanel('link');
  }
  function insertLink(label: string, target: string) {
    const view = editor.current?.getView();
    if (!linkRequest || !view || activeRef.current?.id !== linkRequest.tabId) {
      error('原编辑标签已切换，正文未修改。请重新选择插入位置。');
      return;
    }
    if (
      workspace.getTab(linkRequest.tabId)?.content !== linkRequest.content ||
      view.state.doc.toString() !== linkRequest.content
    ) {
      error('选择链接期间正文发生了变化，原文已保留。请重新选择插入位置。');
      return;
    }
    view.dispatch({ selection: { anchor: linkRequest.from, head: linkRequest.to } });
    editor.current?.insert(markdownLink(label, target));
    setPanel(null);
    setLinkRequest(null);
    setTimeout(() => editor.current?.focus(), 0);
  }
  async function image(file: File): Promise<string | null> {
    const note = activeRef.current;
    if (!note) return null;
    if (!note.path) {
      notify('插入本地图片前，请先选择笔记保存位置。');
      if (!(await workspace.save(note.id, true))) return null;
    }
    const path = workspace.getTab(note.id)?.path;
    if (!path) {
      error('尚未完成笔记保存，请保存后重新插入图片。');
      return null;
    }
    const result = await window.notes.putAttachment(
      path,
      file.name,
      Array.from(new Uint8Array(await file.arrayBuffer())),
    );
    return result.reference;
  }
  async function followLink(target: string) {
    if (!active?.path) {
      notify('请先保存笔记，再打开相对链接。');
      return;
    }
    await run('打开链接', async () => {
      const resolved = await window.notes.resolveLink(active.path!, target);
      if (resolved.external) {
        await window.notes.openExternal(resolved.external);
        return;
      }
      if (!resolved.path || !resolved.exists) {
        if (!resolved.candidates.length) {
          const readable = (value: string) => {
            try {
              return decodeURIComponent(value);
            } catch {
              return value;
            }
          };
          const savedLink = extractLinks(active.baseContent).some(
            (link) => !link.image && readable(link.target) === readable(target),
          );
          if (active.dirty && !savedLink) {
            notify('这是尚未保存的新链接，请先保存笔记再打开。', true);
            return;
          }
          const note = await window.notes.openLinkedFile(active.path!, target);
          if (note) {
            const id = workspace.openDocument(note);
            setGraphActive(false);
            const targetHeading = resolved.heading || target.split('#')[1]?.split('|')[0];
            const heading =
              targetHeading &&
              extractHeadings(note.content).find(
                (item) =>
                  item.text === readable(targetHeading) || item.id === readable(targetHeading),
              );
            if (heading) setPendingLine({ id, line: heading.line });
            return;
          }
        }
        notify(
          resolved.candidates.length > 1
            ? `存在多个同名目标：${resolved.candidates.join('、')}`
            : `没有找到链接目标：${target}`,
          true,
        );
        return;
      }
      await open(resolved.path);
      if (resolved.heading) {
        const note = await window.notes.openFile(resolved.path);
        const heading =
          note &&
          extractHeadings(note.content).find(
            (item) => item.text === resolved.heading || item.id === resolved.heading,
          );
        if (heading) {
          const id = workspace.tabs.find((tab) => tab.path === resolved.path)?.id;
          if (id) setPendingLine({ id, line: heading.line });
          else setTimeout(() => editor.current?.scrollToLine(heading.line), 100);
        }
      }
    });
  }
  async function requestClose(id: string) {
    const tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    if (tab.dirty || (!tab.path && tab.content)) {
      setClosingId(id);
      setPanel('close');
      return;
    }
    workspace.removeTab(id);
  }
  async function localizeImages(target?: string) {
    if (!active?.path) return;
    await run('本地化网络图片', async () => {
      const result = await window.notes.localizeImages(
        active.path!,
        active.content,
        target ? [target] : undefined,
      );
      const latest = workspace.getTab(active.id);
      if (latest && latest.content === active.content)
        updateTab(active.id, {
          content: result.content,
          dirty: result.content !== latest.baseContent,
        });
      else if (result.content !== active.content) {
        workspace.newDraft(result.content, `${active.title} · 图片本地化`);
        notify('处理期间正文有新修改；本地化结果已保留在独立草稿中。');
      }
      const failures = result.results.filter((item) => item.error);
      notify(
        `图片处理完成：${result.results.length - failures.length} 成功，${failures.length} 失败${failures.length ? `；${failures.map((item) => item.error).join('；')}` : ''}`,
        Boolean(failures.length),
      );
      if (!failures.length) setPanel(null);
    });
  }
  async function updateTags() {
    if (!active?.path) return;
    const nextTags = tagInput
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    await run('更新标签', async () => {
      if (!(await ensureSaved(active.id))) return;
      const note = await window.notes.setTags(active.path!, nextTags);
      updateTab(active.id, (latest) => {
        const content =
          latest.content === active.content
            ? note.content
            : setFrontmatterTags(latest.content, nextTags);
        return {
          ...latest,
          ...note,
          content,
          baseContent: note.content,
          dirty: content !== note.content,
        };
      });
      await workspace.refresh();
      notify('顶部 tags 属性已更新');
    });
  }
  const newNote = useCallback(() => {
    workspace.newDraft();
    setGraphActive(false);
  }, [workspace.newDraft]);
  useEffect(() => {
    if (!settings) return;
    const handler = (event: KeyboardEvent) => {
      if (panel || workspace.conflict || event.isComposing) return;
      const action = Object.entries(settings.shortcuts).find(([, shortcut]) =>
        matchesShortcut(event, shortcut),
      )?.[0];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      switch (action) {
        case 'save':
          if (active) void workspace.save(active.id, true);
          break;
        case 'new':
          newNote();
          break;
        case 'open':
          void open();
          break;
        case 'find':
          setGraphActive(false);
          editor.current?.command('find');
          break;
        case 'settings':
          setPanel('settings');
          break;
        case 'mode':
          if (active) updateTab(active.id, { mode: active.mode === 'live' ? 'source' : 'live' });
          break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [settings, active, newNote, open, panel, workspace.conflict, workspace.save, updateTab]);
  useEffect(() => {
    if (panel !== 'preview' || !active || !preview.current) return;
    preview.current.innerHTML = renderMarkdown(
      active.content,
      settings
        ? {
            codeLineNumbers: settings.codeLineNumbers,
            codeWrap: settings.codeWrap,
            codeFold: settings.codeFold,
          }
        : {},
    );
    void hydrateMarkdown(preview.current, (path) =>
      window.notes.assetUrl(path, active.path || undefined),
    ).catch((reason) => error(`预览排版失败：${errorText(reason)}`));
  }, [
    panel,
    active?.content,
    settings?.codeLineNumbers,
    settings?.codeWrap,
    settings?.codeFold,
    error,
  ]);
  async function exportNote(format: 'html' | 'pdf' | 'zip') {
    if (!active || !settings) return;
    await run(`导出 ${format.toUpperCase()}`, async () => {
      let path: string | null;
      if (format === 'zip') {
        if (!active.path) {
          notify('导出 ZIP 前请先保存笔记。');
          return;
        }
        path = await window.notes.exportBundle(active.path, active.content);
      } else {
        const content = document.createElement('div');
        content.innerHTML = renderMarkdown(active.content, {
          codeLineNumbers: settings.codeLineNumbers,
          codeWrap: settings.codeWrap,
          codeFold: settings.codeFold,
        });
        content.style.cssText =
          'position:fixed;left:-20000px;top:0;width:850px;opacity:0;pointer-events:none';
        document.body.append(content);
        try {
          await hydrateMarkdown(content, (asset) =>
            window.notes.assetUrl(asset, active.path || undefined),
          );
          validateExportContent(content);
          content
            .querySelectorAll('.code-copy,.code-language-toolbar')
            .forEach((element) => element.remove());
          const colors = appearanceColors(settings.appearance, systemDark);
          const foreground = exportTheme ? colors.foreground : '#252b2a';
          const background = exportTheme ? colors.background : '#fff';
          const accent = exportTheme ? colors.accent : '#3b756b';
          const style = `${exportCanvasStyle(background, foreground)}body{--foreground:${foreground};--background:${background};--accent:${accent};font-family:"${settings.appearance.bodyFont.replace(/["<>]/g, '')}",sans-serif;color:${foreground};background:${background};margin:0;line-height:${settings.appearance.lineHeight}}article.markdown-rendered{position:relative;max-width:${settings.appearance.contentWidth}px;margin:40px auto;padding:0 28px;font-size:${settings.appearance.fontSize}px;background:${exportWallpaper ? `color-mix(in srgb,${background} ${settings.appearance.editorOpacity * 100}%,transparent)` : background}}article img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd3cf;padding:8px}pre{white-space:pre-wrap;background:${exportTheme ? 'color-mix(in srgb,var(--foreground) 5%,var(--background))' : '#f4f5f2'};padding:16px;border-radius:6px}blockquote{border-left:3px solid ${accent};padding-left:16px}svg{max-width:100%}.export-wallpaper{position:fixed;inset:0;z-index:-1;width:100%;height:100%;object-fit:${settings.appearance.wallpaperFit === 'contain' ? 'contain' : 'cover'};object-position:${settings.appearance.wallpaperPosition};opacity:${settings.appearance.wallpaperOpacity};filter:blur(${settings.appearance.wallpaperBlur}px) brightness(${settings.appearance.wallpaperBrightness})}@media print{article.markdown-rendered{margin:0;max-width:none}pre,table,img{break-inside:avoid}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
          const title = active.title.replace(/[<>&"]/g, '');
          const wallpaper =
            exportWallpaper && wallpaperUrl
              ? settings.appearance.wallpaperFit === 'repeat'
                ? '<div class="export-wallpaper export-wallpaper-tile"></div>'
                : `<img class="export-wallpaper" src="${wallpaperUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="">`
              : '';
          const wallpaperStyle =
            exportWallpaper && wallpaperUrl && settings.appearance.wallpaperFit === 'repeat'
              ? `.export-wallpaper-tile{background-image:url(${JSON.stringify(wallpaperUrl)});background-repeat:repeat;background-position:${settings.appearance.wallpaperPosition}}`
              : '';
          const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>${style}body{isolation:isolate}.export-wallpaper{z-index:0;pointer-events:none}article.markdown-rendered{z-index:1}${wallpaperStyle}</style></head><body>${wallpaper}<article class="markdown-rendered">${content.innerHTML}</article></body></html>`;
          path = await window.notes.exportDocument({
            format,
            html,
            notePath: active.path,
            title: active.title,
          });
        } finally {
          content.remove();
        }
      }
      if (path)
        notify(`已导出：${fileName(path)}`, false, {
          label: '在文件夹中查看',
          run: () => {
            void window.notes.revealPath(path!).catch((reason) => error(errorText(reason)));
          },
        });
    });
  }
  async function journal(
    kind: 'daily' | 'weekly' | 'monthly',
    date: string,
    templateId?: string,
    createAdditional?: boolean,
  ) {
    if (!settings) return;
    const choices = settings.templates.filter((item) => item.kind === kind);
    if (choices.length > 1 && !templateId) {
      setJournalChoice({ kind, date, createAdditional });
      setNewTemplate(choices[0].id);
      setPanel('new');
      return;
    }
    await run('创建周期笔记', async () => {
      if (!settings.journalDirectory) {
        const directory = await window.notes.selectDirectory();
        if (!directory) return;
        const next = { ...settings, journalDirectory: directory };
        const saved = await window.notes.saveSettings(next);
        changeSettings(saved);
      }
      const note = await window.notes.periodicNote(
        kind,
        date,
        templateId || choices[0]?.id,
        createAdditional,
      );
      if (note) {
        workspace.openDocument(note);
        setGraphActive(false);
        setPanel(null);
        setJournalChoice(null);
        await workspace.refresh();
        notify('周期笔记已打开');
      }
    });
  }
  function createFromTemplate() {
    const template = settings?.templates.find((item) => item.id === newTemplate);
    const title = newTitle.trim() || '未命名笔记';
    const now = new Date();
    const monday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    monday.setUTCDate(monday.getUTCDate() + 4 - (monday.getUTCDay() || 7));
    const week = Math.ceil(
      ((monday.getTime() - Date.UTC(monday.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7,
    );
    const values: Record<string, string> = {
      title,
      date: dateKey(now),
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1).padStart(2, '0'),
      week: String(week).padStart(2, '0'),
    };
    workspace.newDraft(
      (template?.content || '').replace(
        /\{\{(title|date|year|month|week)\}\}/g,
        (_, key: string) => values[key],
      ),
      title,
    );
    setGraphActive(false);
    setPanel(null);
    setNewTitle('');
  }
  function resize(side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) {
    if (!settings) return;
    event.preventDefault();
    const start = event.clientX;
    const width = side === 'left' ? settings.leftWidth : settings.rightWidth;
    const move = (pointer: PointerEvent) =>
      changeSettings({
        ...settings,
        [side === 'left' ? 'leftWidth' : 'rightWidth']: Math.max(
          175,
          Math.min(440, width + (pointer.clientX - start) * (side === 'left' ? 1 : -1)),
        ),
      });
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }
  if (workspace.loadError)
    return (
      <main className="startup-state">
        <FileText size={34} />
        <h1>轻笺未能打开</h1>
        <p role="alert">{workspace.loadError}</p>
        <button onClick={() => window.location.reload()}>重新连接</button>
      </main>
    );
  if (!settings || !workspace.bootstrap)
    return (
      <main className="startup-state">
        <span className="brand-mark">轻笺</span>
        <p role="status">正在恢复你的笔记…</p>
      </main>
    );
  const appearance = settings.appearance;
  const { dark, foreground, background, accent } = appearanceColors(appearance, systemDark);
  const style = {
    '--accent': accent,
    '--background': background,
    '--foreground': foreground,
    '--ui-font': `"${appearance.uiFont}",sans-serif`,
    '--body-font': `"${appearance.bodyFont}",sans-serif`,
    '--code-font': `"${appearance.codeFont}",monospace`,
    '--heading-font': `"${appearance.headingFont}",sans-serif`,
    '--editor-font-size': `${appearance.fontSize}px`,
    '--editor-line-height': appearance.lineHeight,
    '--content-width': `${appearance.contentWidth}px`,
    '--editor-opacity': appearance.editorOpacity,
    '--left-width': `${settings.leftWidth}px`,
    '--right-width': `${settings.rightWidth}px`,
  } as CSSProperties;
  const line = active ? active.content.slice(0, active.cursor).split('\n').length : 1;
  return (
    <OperationContext.Provider value={{ busy, notice: workspace.notices.at(-1) || null }}>
      <div className="app" data-theme={dark ? 'dark' : 'light'} style={style}>
        {wallpaperUrl && (
          <div
            className="wallpaper"
            style={{
              backgroundImage: `url(${JSON.stringify(wallpaperUrl)})`,
              opacity: appearance.wallpaperOpacity,
              filter: `blur(${appearance.wallpaperBlur}px) brightness(${appearance.wallpaperBrightness})`,
              backgroundSize:
                appearance.wallpaperFit === 'repeat' ? 'auto' : appearance.wallpaperFit,
              backgroundRepeat: appearance.wallpaperFit === 'repeat' ? 'repeat' : 'no-repeat',
              backgroundPosition: appearance.wallpaperPosition,
            }}
          />
        )}
        <header className="app-header">
          <div className="app-brand">
            <span className="logo-glyph">笺</span>
            <strong>轻笺</strong>
            <span className="brand-divider" />
            <span className="header-context">让想法自然落笔</span>
          </div>
          <div className="header-actions">
            <IconButton
              label={settings.leftVisible ? '收起左侧导航' : '显示左侧导航'}
              onClick={() => changeSettings({ ...settings, leftVisible: !settings.leftVisible })}
            >
              {settings.leftVisible ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </IconButton>
            <IconButton label="打开 Markdown 文件" onClick={() => void open()}>
              <FolderOpen size={17} />
            </IconButton>
            <IconButton label="新建空白笔记" onClick={newNote}>
              <FilePlus2 size={17} />
            </IconButton>
            <IconButton
              label="关系图谱"
              onClick={() => {
                setGraphOpen(true);
                setGraphActive(true);
              }}
            >
              <Network size={17} />
            </IconButton>
            <span className="toolbar-separator" />
            <IconButton
              label={settings.rightVisible ? '收起右侧大纲' : '显示右侧大纲'}
              onClick={() => changeSettings({ ...settings, rightVisible: !settings.rightVisible })}
            >
              {settings.rightVisible ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
            </IconButton>
            <IconButton label="打开设置" onClick={() => setPanel('settings')}>
              <Settings size={17} />
            </IconButton>
          </div>
        </header>
        <main className="workspace">
          {settings.leftVisible && (
            <>
              <Sidebar
                settings={settings}
                trees={workspace.trees}
                index={workspace.index}
                activePath={active?.path || null}
                onSettings={changeSettings}
                onOpen={(path, targetLine) => void open(path, targetLine)}
                onNew={newNote}
                onJournal={(kind, date, templateId, createAdditional) =>
                  void journal(kind, date, templateId, createAdditional)
                }
                onError={error}
              />
              <div
                role="separator"
                aria-label="调整左侧栏宽度"
                aria-orientation="vertical"
                tabIndex={0}
                className="panel-resizer"
                onPointerDown={(event) => resize('left', event)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                    changeSettings({
                      ...settings,
                      leftWidth: Math.max(
                        175,
                        Math.min(440, settings.leftWidth + (event.key === 'ArrowLeft' ? -12 : 12)),
                      ),
                    });
                }}
              />
            </>
          )}
          <section className="editor-column" aria-label="笔记编辑区">
            <div className="tabs-bar" role="tablist" aria-label="打开的笔记">
              {tabs.map((tab) => (
                <div
                  className={`document-tab ${!graphActive && tab.id === activeId ? 'active' : ''}`}
                  key={tab.id}
                >
                  <button
                    role="tab"
                    aria-selected={!graphActive && tab.id === activeId}
                    title={tab.path || '未命名草稿'}
                    onClick={() => {
                      workspace.setActiveId(tab.id);
                      setGraphActive(false);
                    }}
                  >
                    <FileText size={14} />
                    <span>{tab.title}</span>
                    {tab.dirty && <i aria-label="有未保存修改" />}
                  </button>
                  <IconButton label={`关闭 ${tab.title}`} onClick={() => void requestClose(tab.id)}>
                    <X size={13} />
                  </IconButton>
                </div>
              ))}
              {graphOpen && (
                <div className={`document-tab ${graphActive ? 'active' : ''}`}>
                  <button
                    role="tab"
                    aria-selected={graphActive}
                    onClick={() => setGraphActive(true)}
                  >
                    <Network size={14} />
                    <span>关系图谱</span>
                  </button>
                  <IconButton
                    label="关闭关系图谱"
                    onClick={() => {
                      setGraphOpen(false);
                      setGraphActive(false);
                    }}
                  >
                    <X size={13} />
                  </IconButton>
                </div>
              )}
              <IconButton label="新建笔记" onClick={newNote}>
                <PlusIcon />
              </IconButton>
            </div>
            {graphActive && graphOpen ? (
              <GraphView
                index={workspace.index}
                settings={settings}
                activePath={active?.path || null}
                onSettings={changeSettings}
                onOpen={(path) => void open(path)}
                onError={error}
              />
            ) : (
              active && (
                <>
                  <div className="document-heading">
                    <div className="document-breadcrumb">
                      <FileText size={13} />
                      <span title={active.path || ''}>
                        {active.path
                          ? active.path.split(/[\\/]/).slice(-2).join(' / ')
                          : '草稿 / 尚未选择保存位置'}
                      </span>
                    </div>
                    <div className="document-actions">
                      <button
                        className="save-button"
                        disabled={workspace.saving.includes(active.id)}
                        onClick={() => void workspace.save(active.id, true)}
                      >
                        {workspace.saving.includes(active.id) ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : active.dirty ? (
                          <Save size={14} />
                        ) : (
                          <Check size={14} />
                        )}
                        <span>
                          {workspace.saving.includes(active.id)
                            ? '保存中'
                            : active.dirty
                              ? '保存'
                              : active.path
                                ? '已保存'
                                : '另存为'}
                        </span>
                      </button>
                      <div className="menu-anchor">
                        <IconButton
                          label="笔记操作菜单"
                          aria-expanded={menu}
                          onClick={() => setMenu(!menu)}
                        >
                          <Ellipsis size={19} />
                        </IconButton>
                        {menu && (
                          <>
                            <button
                              className="menu-dismiss"
                              aria-label="关闭笔记菜单"
                              onClick={() => setMenu(false)}
                            />
                            <div className="dropdown-menu" role="menu">
                              {[
                                [
                                  '从模板新建',
                                  () => {
                                    setJournalChoice(null);
                                    setNewTemplate(
                                      settings.templates.find((item) => item.kind === 'note')?.id ||
                                        '',
                                    );
                                    setPanel('new');
                                  },
                                ],
                                ['查找与替换', () => editor.current?.command('replace')],
                                ['阅读预览', () => setPanel('preview')],
                                ...(active.path
                                  ? ([
                                      ['版本历史', () => setPanel('history')],
                                      [
                                        '移动 / 重命名',
                                        () => {
                                          setMovePath(active.path!);
                                          setPanel('move');
                                        },
                                      ],
                                      ...(remoteImages.length
                                        ? ([
                                            [
                                              '网络图片本地化',
                                              () => {
                                                setLocalizeTarget('');
                                                setPanel('localize');
                                              },
                                            ],
                                          ] as [string, () => void][])
                                        : []),
                                      ['移入系统回收站', () => setPanel('delete')],
                                    ] as [string, () => void][])
                                  : []),
                                ['导出 PDF', () => void exportNote('pdf')],
                                ['导出 HTML', () => void exportNote('html')],
                                ...(active.path
                                  ? ([
                                      ['导出 Markdown 与附件 ZIP', () => void exportNote('zip')],
                                    ] as [string, () => void][])
                                  : []),
                                [
                                  '检查未引用附件',
                                  () =>
                                    void run('准备附件检查', async () => {
                                      await workspace.persistSession();
                                      setPanel('attachments');
                                    }),
                                ],
                              ].map(([label, action]) => (
                                <button
                                  role="menuitem"
                                  key={String(label)}
                                  onClick={() => {
                                    setMenu(false);
                                    if (typeof action === 'function') action();
                                  }}
                                >
                                  {String(label)}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {settings.toolbarVisible && (
                    <div className="editor-toolbar">
                      <div className="toolbar-formatting">
                        <IconButton label="撤销" onClick={() => editor.current?.command('undo')}>
                          <Undo2 size={16} />
                        </IconButton>
                        <IconButton label="重做" onClick={() => editor.current?.command('redo')}>
                          <Redo2 size={16} />
                        </IconButton>
                        <span className="toolbar-separator" />
                        {buttons
                          .filter((button) => settings.toolbarButtons.includes(button.id))
                          .map((button) => (
                            <IconButton
                              label={button.title}
                              key={button.id}
                              onClick={() =>
                                button.id === 'image'
                                  ? imageInput.current?.click()
                                  : button.id === 'link'
                                    ? beginLink()
                                    : editor.current?.command(button.id)
                              }
                            >
                              <button.icon size={16} />
                            </IconButton>
                          ))}
                      </div>
                      <button
                        className="mode-button"
                        onClick={() =>
                          updateTab(active.id, { mode: active.mode === 'live' ? 'source' : 'live' })
                        }
                      >
                        {active.mode === 'source' ? <Code2 size={14} /> : <AlignLeft size={14} />}
                        <span>{active.mode === 'source' ? '源码' : '即时排版'}</span>
                      </button>
                    </div>
                  )}
                  <div className="editor-surface">
                    <MarkdownEditor
                      key={active.id}
                      ref={editor}
                      value={active.content}
                      mode={active.mode}
                      settings={settings}
                      notePath={active.path}
                      initialCursor={active.cursor}
                      initialScroll={active.scrollTop}
                      onChange={(content) =>
                        updateTab(active.id, (latest) => ({
                          ...latest,
                          content,
                          dirty: content !== latest.baseContent,
                        }))
                      }
                      onCursor={(cursor) => updateTab(active.id, { cursor })}
                      onScroll={(scrollTop) => updateTab(active.id, { scrollTop })}
                      onLink={(target) => void followLink(target)}
                      onImage={image}
                      onError={error}
                    />
                  </div>
                </>
              )
            )}
            {settings.statusVisible && (
              <footer className="status-bar">
                <span>
                  {busy ? (
                    <>
                      <LoaderCircle size={12} className="spin" />
                      {busy}中…
                    </>
                  ) : workspace.progress ? (
                    workspace.progress.message
                  ) : active?.path ? (
                    settings.autoSave ? (
                      '自动保存已开启'
                    ) : (
                      '自动保存已关闭'
                    )
                  ) : (
                    '草稿会自动保留'
                  )}
                </span>
                <div>
                  {active && (
                    <>
                      <span>{active.content.replace(/\s/g, '').length.toLocaleString()} 字</span>
                      <span>行 {line}</span>
                      <span>UTF-8</span>
                      <span>Markdown</span>
                    </>
                  )}
                </div>
              </footer>
            )}
          </section>
          {settings.rightVisible && (
            <>
              <div
                role="separator"
                aria-label="调整右侧栏宽度"
                aria-orientation="vertical"
                tabIndex={0}
                className="panel-resizer"
                onPointerDown={(event) => resize('right', event)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                    changeSettings({
                      ...settings,
                      rightWidth: Math.max(
                        175,
                        Math.min(440, settings.rightWidth + (event.key === 'ArrowLeft' ? 12 : -12)),
                      ),
                    });
                }}
              />
              <aside className="sidebar right-sidebar" aria-label="大纲与反向引用">
                <div className="right-section">
                  <h2>
                    <AlignLeft size={15} />
                    大纲<span>{headings.length}</span>
                  </h2>
                  <nav className="outline">
                    {headings.map((heading, i) => (
                      <button
                        key={`${heading.line}:${i}`}
                        style={{ paddingLeft: 12 + (heading.level - 1) * 12 }}
                        onClick={() => {
                          setGraphActive(false);
                          editor.current?.scrollToLine(heading.line);
                        }}
                      >
                        {heading.text || '未命名标题'}
                      </button>
                    ))}
                    {!headings.length && <p className="subtle">写下标题，思路便有了轮廓。</p>}
                  </nav>
                </div>
                <div className="right-section">
                  <h2>
                    <Hash size={15} />
                    标签<span>{tags.length}</span>
                  </h2>
                  <div className="note-tags">
                    {tags.map((tag) => (
                      <span className="tag" key={tag}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                  {active?.path && (
                    <form
                      className="tag-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void updateTags();
                      }}
                    >
                      <input
                        aria-label="编辑顶部标签属性"
                        placeholder="逗号分隔标签…"
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                      />
                      <button disabled={Boolean(busy)} type="submit">
                        更新属性
                      </button>
                    </form>
                  )}
                </div>
                <div className="right-section">
                  <h2>
                    <Link2 size={15} />
                    反向引用<span>{backlinks.length}</span>
                  </h2>
                  {backlinks.map((note) => (
                    <button
                      className="backlink-row"
                      key={note.path}
                      onClick={() => void open(note.path)}
                    >
                      <FileText size={14} />
                      <span>{note.title}</span>
                    </button>
                  ))}
                  {!backlinks.length && (
                    <p className="subtle">已添加目录中，还没有笔记链接到这里。</p>
                  )}
                </div>
                <button
                  className="local-graph-button"
                  onClick={() => {
                    changeSettings({ ...settings, graph: { ...settings.graph, local: true } });
                    setGraphOpen(true);
                    setGraphActive(true);
                  }}
                >
                  <Network size={15} />
                  查看局部关系图
                </button>
              </aside>
            </>
          )}
        </main>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            const targetId = activeRef.current?.id;
            const targetEditor = editor.current;
            if (file)
              void run('插入图片', async () => {
                const reference = await image(file);
                if (!reference) return;
                const destination = /[\s()]/.test(reference)
                  ? `<${reference.replace(/>/g, '%3E')}>`
                  : reference;
                const markdown = `![${file.name.replace(/[\[\]]/g, '')}](${destination})`;
                if (targetEditor && editor.current === targetEditor) targetEditor.insert(markdown);
                else if (targetId && workspace.getTab(targetId)) {
                  updateTab(targetId, (latest) => ({
                    ...latest,
                    content: `${latest.content}\n${markdown}\n`,
                    dirty: true,
                  }));
                  notify('已将图片追加到原笔记末尾。');
                } else notify('图片已保存；原笔记标签已关闭，正文未修改。');
              });
            event.target.value = '';
          }}
        />
        <div className="toast-region" aria-live="polite">
          {workspace.notices.map((notice) => (
            <div className={`toast ${notice.error ? 'error' : ''}`} key={notice.id}>
              <span>{notice.message}</span>
              {notice.action && <button onClick={notice.action.run}>{notice.action.label}</button>}
              <IconButton
                label="关闭通知"
                onClick={() =>
                  workspace.setNotices((previous) =>
                    previous.filter((item) => item.id !== notice.id),
                  )
                }
              >
                <X size={14} />
              </IconButton>
            </div>
          ))}
        </div>
        {workspace.closing && (
          <div className="closing-overlay" role="status">
            <LoaderCircle className="spin" size={24} />
            <p>正在保存笔记与草稿，完成后关闭…</p>
          </div>
        )}
        {panel === 'settings' && (
          <SettingsPanel
            settings={settings}
            fonts={fonts}
            dataDirectory={workspace.bootstrap.dataDirectory}
            version={workspace.bootstrap.version}
            onChange={changeSettings}
            onFonts={setFonts}
            onClose={() => setPanel(null)}
            onError={error}
            saveState={workspace.settingsState}
          />
        )}
        {panel === 'link' && linkRequest && (
          <LinkPanel
            sourcePath={linkRequest.sourcePath}
            initialLabel={linkRequest.label}
            index={workspace.index}
            onInsert={insertLink}
            onClose={() => {
              setPanel(null);
              setLinkRequest(null);
            }}
          />
        )}
        {panel === 'new' && (
          <Modal
            title={journalChoice ? '选择周期笔记模板' : '从模板新建笔记'}
            onClose={() => {
              setPanel(null);
              setJournalChoice(null);
            }}
          >
            <div className="panel-content">
              {!journalChoice && (
                <label className="stack-label">
                  笔记标题
                  <input
                    autoFocus
                    aria-label="新笔记标题"
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder="给想法起个名字"
                  />
                </label>
              )}
              <label className="stack-label">
                模板
                <select
                  aria-label="新笔记模板"
                  value={newTemplate}
                  onChange={(event) => setNewTemplate(event.target.value)}
                >
                  {!journalChoice && <option value="">空白笔记</option>}
                  {settings.templates
                    .filter((template) => template.kind === (journalChoice?.kind || 'note'))
                    .map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                </select>
              </label>
              <pre className="template-preview">
                {settings.templates.find((template) => template.id === newTemplate)?.content ||
                  '一张空白纸，等待你的想法。'}
              </pre>
              <footer className="dialog-actions">
                <button onClick={() => setPanel(null)}>取消</button>
                <button
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    journalChoice
                      ? void journal(
                          journalChoice.kind,
                          journalChoice.date,
                          newTemplate,
                          journalChoice.createAdditional,
                        )
                      : createFromTemplate()
                  }
                >
                  创建笔记
                </button>
              </footer>
            </div>
          </Modal>
        )}
        {panel === 'history' && active && (
          <HistoryPanel
            tab={active}
            onClose={() => setPanel(null)}
            onError={error}
            onRestore={async (id) => {
              if (!(await ensureSaved(active.id)))
                throw new Error('当前内容尚未成功保存，恢复已停止。');
              const note = await window.notes.restoreHistory(id);
              updateTab(active.id, { ...note, baseContent: note.content, dirty: false });
              await workspace.refresh();
              notify('已恢复所选历史，恢复前状态也已保留');
            }}
          />
        )}
        {panel === 'attachments' && (
          <AttachmentPanel onClose={() => setPanel(null)} onError={error} onSuccess={notify} />
        )}
        {panel === 'localize' && active?.path && (
          <Modal title="将网络图片保存在本地" onClose={() => setPanel(null)}>
            <div className="panel-content">
              <p className="section-description">
                仅在点击后下载；成功后改为相对附件路径，失败的图片保留原网址。
              </p>
              <div className="localize-options">
                <label>
                  <input
                    type="radio"
                    name="localize-target"
                    checked={!localizeTarget}
                    onChange={() => setLocalizeTarget('')}
                  />
                  <strong>整篇图片</strong>
                  <span>{remoteImages.length} 个网址</span>
                </label>
                {remoteImages.map((url) => (
                  <label key={url}>
                    <input
                      type="radio"
                      name="localize-target"
                      checked={localizeTarget === url}
                      onChange={() => setLocalizeTarget(url)}
                    />
                    <span>{url}</span>
                  </label>
                ))}
              </div>
              <footer className="dialog-actions">
                <button onClick={() => setPanel(null)}>取消</button>
                <button
                  className="primary"
                  disabled={Boolean(busy) || !remoteImages.length}
                  onClick={() => void localizeImages(localizeTarget || undefined)}
                >
                  下载{localizeTarget ? '此张图片' : '整篇图片'}
                </button>
              </footer>
            </div>
          </Modal>
        )}
        {panel === 'move' && active?.path && (
          <Modal title="移动 / 重命名笔记" onClose={() => setPanel(null)}>
            <div className="panel-content">
              <p className="section-description">
                填写完整目标路径；软件会修复已添加目录中的链接，并提供撤销。
              </p>
              <label className="stack-label">
                目标路径
                <input
                  autoFocus
                  aria-label="移动目标完整路径"
                  value={movePath}
                  onChange={(event) => setMovePath(event.target.value)}
                />
              </label>
              <footer className="dialog-actions">
                <button onClick={() => setPanel(null)}>取消</button>
                <button
                  className="primary"
                  disabled={Boolean(busy) || !movePath.trim() || movePath === active.path}
                  onClick={() =>
                    void run('移动笔记', async () => {
                      if (!(await ensureSaved(active.id))) return;
                      const result = await window.notes.moveFile(active.path!, movePath.trim());
                      if (!result) return;
                      const note = await window.notes.openFile(result.path);
                      if (note)
                        updateTab(active.id, { ...note, baseContent: note.content, dirty: false });
                      await workspace.refresh();
                      setPanel(null);
                      notify(`已移动，修复 ${result.affected.length} 个引用文件`, false, {
                        label: '撤销移动',
                        run: () => {
                          void run('撤销移动', async () => {
                            await window.notes.undoMove(result.undoId);
                            const old = await window.notes.openFile(active.path!);
                            if (old)
                              updateTab(active.id, {
                                ...old,
                                baseContent: old.content,
                                dirty: false,
                              });
                            await workspace.refresh();
                            notify('移动和引用修改已撤销');
                          });
                        },
                      });
                    })
                  }
                >
                  移动并修复链接
                </button>
              </footer>
            </div>
          </Modal>
        )}
        {panel === 'delete' && active?.path && (
          <Modal title="移入系统回收站" onClose={() => setPanel(null)}>
            <div className="panel-content">
              <p>
                将「{active.title}」移入回收站？附件会保留。需要恢复时，可在 Windows 回收站中操作。
              </p>
              {active.dirty && (
                <p className="inline-error">当前有未保存修改，将先保存成功再移入回收站。</p>
              )}
              <footer className="dialog-actions">
                <button onClick={() => setPanel(null)}>取消</button>
                <button
                  className="danger"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('移入回收站', async () => {
                      if (!(await ensureSaved(active.id))) return;
                      await window.notes.trashFile(active.path!);
                      workspace.removeTab(active.id);
                      setPanel(null);
                      await workspace.refresh();
                      notify('笔记已移入系统回收站，附件仍保留');
                    })
                  }
                >
                  移入回收站
                </button>
              </footer>
            </div>
          </Modal>
        )}
        {panel === 'close' && (
          <Modal title="关闭笔记" onClose={() => setPanel(null)}>
            <div className="panel-content">
              <p>
                「{tabs.find((tab) => tab.id === closingId)?.title}
                」还有未保存内容。保存成功后再关闭，或明确丢弃修改。
              </p>
              <footer className="dialog-actions">
                <button onClick={() => setPanel(null)}>继续编辑</button>
                <button
                  className="danger-text"
                  onClick={() => {
                    if (closingId) workspace.removeTab(closingId);
                    setPanel(null);
                  }}
                >
                  丢弃修改并关闭
                </button>
                <button
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('保存笔记', async () => {
                      if (closingId && (await workspace.save(closingId, true))) {
                        if (workspace.getTab(closingId)?.dirty) {
                          notify('保存期间有新修改，内容已保留，请再次保存。');
                          return;
                        }
                        workspace.removeTab(closingId);
                        setPanel(null);
                      }
                    })
                  }
                >
                  保存并关闭
                </button>
              </footer>
            </div>
          </Modal>
        )}
        {panel === 'preview' && active && (
          <Modal title={`阅读预览 · ${active.title}`} onClose={() => setPanel(null)} wide>
            <div className="preview-actions">
              <label>
                <input
                  type="checkbox"
                  checked={exportTheme}
                  onChange={(event) => setExportTheme(event.target.checked)}
                />
                导出沿用当前主题
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={exportWallpaper}
                  disabled={!wallpaperUrl}
                  onChange={(event) => setExportWallpaper(event.target.checked)}
                />
                导出包含壁纸
              </label>
              <button disabled={Boolean(busy)} onClick={() => void exportNote('pdf')}>
                导出 PDF
              </button>
              <button disabled={Boolean(busy)} onClick={() => void exportNote('html')}>
                导出 HTML
              </button>
            </div>
            <article
              className="reading-preview markdown-rendered"
              style={{
                backgroundColor: exportTheme ? background : '#fff',
                color: exportTheme ? foreground : '#252b2a',
              }}
              ref={preview}
              onClick={(event) => {
                const target = event.target instanceof Element ? event.target.closest('a') : null;
                const href = target?.getAttribute('href');
                if (href) {
                  event.preventDefault();
                  setPanel(null);
                  void followLink(href);
                }
              }}
            />
          </Modal>
        )}
        {workspace.conflict && (
          <Modal
            title="文件发生外部修改 · 保留你的内容"
            onClose={() => notify('冲突内容会保留。请比较后选择处理方式。')}
            wide
          >
            <div className="panel-content">
              <p>
                本地编辑与磁盘内容无法自动合并。两份原文都在这里；保留双方会把本地版本放入独立草稿。
              </p>
              <div className="compare-grid">
                <label>
                  我的编辑
                  <textarea
                    aria-label="冲突本地版本"
                    readOnly
                    value={
                      tabs.find((tab) => tab.id === workspace.conflict?.tabId)?.content ||
                      workspace.conflict.detail.ours
                    }
                  />
                </label>
                <label>
                  磁盘上的版本
                  <textarea
                    aria-label="冲突外部版本"
                    readOnly
                    value={workspace.conflict.detail.theirs}
                  />
                </label>
              </div>
              <footer className="dialog-actions">
                <button onClick={workspace.keepBoth}>保留双方，稍后整理</button>
                <button
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('保存本地版本', async () => {
                      const conflict = workspace.conflict;
                      if (!conflict) return;
                      const tab = tabs.find((item) => item.id === conflict.tabId);
                      if (!tab) return;
                      const result = await window.notes.saveFile({
                        path: conflict.detail.path,
                        content: tab.content,
                        baseContent: conflict.detail.theirs,
                        hash: conflict.detail.hash,
                        title: tab.title,
                      });
                      if (result.status === 'saved' && result.note) {
                        updateTab(tab.id, {
                          ...result.note,
                          baseContent: result.note.content,
                          dirty: false,
                        });
                        workspace.setConflict(null);
                        notify('已按选择保存本地版本；外部版本已由历史保留');
                      } else if (result.conflict) {
                        workspace.setConflict({ tabId: tab.id, detail: result.conflict });
                        error('文件再次变化，请重新比较。');
                      }
                    })
                  }
                >
                  以我的编辑保存
                </button>
              </footer>
            </div>
          </Modal>
        )}
      </div>
    </OperationContext.Provider>
  );
}
function PlusIcon() {
  return <span className="plus-icon">+</span>;
}
