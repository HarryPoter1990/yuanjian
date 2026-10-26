// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopAPI,
  NoteDocument,
  SaveOutcome,
  SaveRequest,
  SessionState,
  WindowModeState,
} from '../src/shared/types';
import { defaultSettings } from '../src/shared/defaults';
import { asTab } from '../src/ui/model';
import { useWorkspace } from '../src/ui/useWorkspace';
import { SettingsPanel } from '../src/components/SettingsPanel';
import { Sidebar } from '../src/components/Sidebar';
import { IconButton, Modal, OperationContext } from '../src/components/Controls';
import App from '../src/App';

const editorCalls = vi.hoisted(() => ({
  scrollToLine: vi.fn(),
  insert: vi.fn(),
  dispatch: vi.fn(),
  from: 0,
  to: 0,
}));
vi.mock('../src/editor/MarkdownEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const { EditorState } = await import('@codemirror/state');
  return {
    MarkdownEditor: forwardRef(function TestEditor(
      props: { value: string; onLink?(target: string): void },
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        getHeadingLevel: () => 0,
        getScrollAnchor: () => undefined,
        restorePosition() {},
        setHeading() {},
        focus() {},
        insert: editorCalls.insert,
        wrap() {},
        command() {
          return true;
        },
        scrollToLine: editorCalls.scrollToLine,
        getCursor() {
          return 0;
        },
        getScroll() {
          return 0;
        },
        getView() {
          return {
            state: EditorState.create({
              doc: props.value,
              selection: { anchor: editorCalls.from, head: editorCalls.to },
            }),
            dispatch: editorCalls.dispatch,
          };
        },
      }));
      return (
        <div aria-label="测试正文编辑器">
          <button onClick={() => props.onLink?.('另一篇.md#目标')}>打开测试相对链接</button>
          <button onClick={() => props.onLink?.('https://example.com/guide')}>
            打开测试外部链接
          </button>
        </div>
      );
    }),
  };
});
vi.mock('../src/editor/renderer', () => ({
  renderMarkdown: () => '',
  hydrateMarkdown: async () => undefined,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const note: NoteDocument = {
  id: 'note',
  path: 'D:\\notes\\学习.md',
  title: '学习.md',
  content: '初始内容',
  hash: 'hash0',
  modifiedAt: 1,
};
let root: Root;
let host: HTMLDivElement;
let value: ReturnType<typeof useWorkspace>;
let onClose: () => void;
let api: DesktopAPI;
function Harness() {
  value = useWorkspace();
  return null;
}
function makeAPI(session: SessionState): DesktopAPI {
  const settings = structuredClone(defaultSettings);
  return {
    prepareFiles: vi.fn(async () => []),
    pendingHistory: vi.fn(async () => []),
    retryHistoryWork: vi.fn(async () => {}),
    chooseImports: vi.fn(async () => []),
    readImport: vi.fn(async () => {
      throw new Error('此夹具未提供导入来源');
    }),
    importAssetUrl: vi.fn(async () => {
      throw new Error('此夹具未提供导入图片');
    }),
    centerWindow: vi.fn(async () => undefined),
    bootstrap: vi.fn(async () => ({
      settings,
      session,
      fonts: [],
      dataDirectory: 'D:\\data',
      version: 'test',
    })),
    saveSettings: vi.fn(async (next) => next),
    getWindowMode: vi.fn(async () => ({ mode: 'full' as const, pinned: true })),
    setWindowMode: vi.fn(async (mode) => ({ mode, pinned: true })),
    setStickyPinned: vi.fn(async (pinned) => ({ mode: 'sticky' as const, pinned })),
    onWindowModeChanged: vi.fn(() => () => {}),
    setWindowTheme: vi.fn(async () => undefined),
    saveSession: vi.fn(async () => undefined),
    openFile: vi.fn(async () => note),
    saveFile: vi.fn(async (request: SaveRequest): Promise<SaveOutcome> => ({
      status: 'saved',
      note: { ...note, content: request.content, hash: 'saved' },
    })),
    selectDirectory: vi.fn(async () => null),
    getTree: vi.fn(async () => []),
    getIndex: vi.fn(async () => []),
    search: vi.fn(async () => []),
    resolveLink: vi.fn(async () => ({ path: null, exists: false, candidates: [] })),
    openLinkedFile: vi.fn(async () => null),
    moveFile: vi.fn(async () => null),
    undoMove: vi.fn(async () => ({ path: note.path!, affected: [], undoId: 'fixture-undo' })),
    retryMoveHistory: vi.fn(async () => undefined),
    trashFile: vi.fn(async () => undefined),
    setTags: vi.fn(async () => note),
    putAttachment: vi.fn(async () => ({ path: 'D:\\a.png', reference: 'assets/a.png' })),
    assetUrl: vi.fn(async () => 'note-asset://test'),
    localizeImages: vi.fn(async (_path, content) => ({ content, results: [] })),
    scanAttachments: vi.fn(async () => []),
    trashAttachments: vi.fn(async () => undefined),
    listHistory: vi.fn(async () => []),
    readHistory: vi.fn(async () => {
      throw new Error('unused');
    }),
    restoreHistory: vi.fn(async () => note),
    pinHistory: vi.fn(async () => undefined),
    historyStats: vi.fn(async () => ({ textBytes: 0, imageBytes: 0, totalBytes: 0, count: 0 })),
    pruneHistory: vi.fn(async () => ({ textBytes: 0, imageBytes: 0, totalBytes: 0, count: 0 })),
    periodicNote: vi.fn(async () => note),
    getFonts: vi.fn(async () => []),
    getFontCatalog: vi.fn(async () => []),
    importFonts: vi.fn(async () => []),
    downloadFont: vi.fn(async () => []),
    removeFont: vi.fn(async () => undefined),
    chooseWallpaper: vi.fn(async () => null),
    exportDocument: vi.fn(async () => null),
    exportBundle: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
    closeReady: vi.fn(async () => undefined),
    onFilesChanged: vi.fn(() => () => undefined),
    onCloseRequested: vi.fn((callback) => {
      onClose = callback;
      return () => undefined;
    }),
    onOpenRequested: vi.fn(() => () => undefined),
    onProgress: vi.fn(() => () => undefined),
  };
}
async function mount(
  session: SessionState = { tabs: [asTab(note)], activeId: note.id },
  configure?: (api: DesktopAPI) => void,
) {
  api = makeAPI(session);
  configure?.(api);
  window.notes = api;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
}
beforeEach(() => {
  editorCalls.scrollToLine.mockClear();
  editorCalls.insert.mockClear();
  editorCalls.dispatch.mockClear();
  editorCalls.from = 0;
  editorCalls.to = 0;
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.useRealTimers();
});
describe('desktop session and save lifecycle', () => {
  it('opens HTTPS from an unnamed draft without saving or resolving a local path', async () => {
    const draft = { ...asTab(note), id: 'draft-url', path: null };
    await mount({ tabs: [draft], activeId: draft.id });
    await act(async () => root.render(<App />));
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === '打开测试外部链接')!
        .click(),
    );
    expect(api.openExternal).toHaveBeenCalledWith('https://example.com/guide');
    expect(api.resolveLink).not.toHaveBeenCalled();
    expect(api.saveFile).not.toHaveBeenCalled();
  });
  it('still requires a saved base path before following a relative link from a draft', async () => {
    const draft = { ...asTab(note), id: 'draft-relative', path: null };
    await mount({ tabs: [draft], activeId: draft.id });
    await act(async () => root.render(<App />));
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === '打开测试相对链接')!
        .click(),
    );
    expect(api.openExternal).not.toHaveBeenCalled();
    expect(api.resolveLink).not.toHaveBeenCalled();
    expect(host.textContent).toContain('请先保存笔记，再打开相对链接。');
  });
  it.each([false, true])(
    'preserves exclusion edits through a native close without blurring the settings field (write failure: %s)',
    async (fails) => {
      await mount(undefined, (api) => {
        if (fails)
          api.saveSettings = vi.fn(async () => {
            throw Error('设置无法保存');
          });
      });
      await act(async () => root.render(<App />));
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="打开设置"]')!.click(),
      );
      const search = host.querySelector<HTMLInputElement>('[aria-label="搜索设置"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          search,
          '索引排除目录',
        );
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="编辑与文件 · 索引排除目录"]')!.click(),
      );
      const field = host.querySelector<HTMLTextAreaElement>('[aria-label="索引排除目录"]')!;
      await act(async () => {
        field.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          field,
          field.value + '\n未提交目录',
        );
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(document.activeElement).toBe(field);
      await act(async () => onClose());
      expect(api.saveSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ excluded: expect.arrayContaining(['未提交目录']) }),
      );
      if (fails) expect(api.closeReady).not.toHaveBeenCalled();
      else expect(api.closeReady).toHaveBeenCalledTimes(1);
      expect(field.value).toContain('未提交目录');
    },
  );
  it('links the document panel to a tab whose real file path contains spaces and Unicode', async () => {
    const documentNote = {
      ...note,
      id: 'D:\\Chinese Notes\\中文 笔记.md',
      path: 'D:\\Chinese Notes\\中文 笔记.md',
    };
    await mount({ tabs: [asTab(documentNote)], activeId: documentNote.id });
    await act(async () => root.render(<App />));
    const panel = host.querySelector<HTMLElement>('#document-panel')!;
    const labels = panel.getAttribute('aria-labelledby')!.split(/\s+/);
    expect(labels).toHaveLength(1);
    expect(document.getElementById(labels[0])).toBe(host.querySelector('.tabs-bar [role="tab"]'));
  });
  it('keeps the startup connection diagnostic visible when the preload bridge is missing', async () => {
    await mount();
    Reflect.deleteProperty(window, 'notes');
    await act(async () => root.render(<App />));
    expect(host.textContent).toContain('鸢笺未能打开');
    expect(host.textContent).toContain('桌面连接不可用');
    expect(host.querySelector('[aria-label="进入便笺模式"]')).toBeNull();
  });
  it.each(['read', 'subscription', 'async read'])(
    'keeps sticky entry unavailable after a %s failure',
    async (failure) => {
      await mount(undefined, (api) => {
        if (failure === 'read')
          api.getWindowMode = vi.fn(() => {
            throw new Error('同步读取失败');
          });
        else if (failure === 'async read')
          api.getWindowMode = vi.fn(async () => {
            throw new Error('异步读取失败');
          });
        else
          api.onWindowModeChanged = vi.fn(() => {
            throw new Error('同步订阅失败');
          });
      });
      await act(async () => root.render(<App />));
      expect(host.querySelector<HTMLButtonElement>('[aria-label="进入便笺模式"]')?.disabled).toBe(
        true,
      );
      expect(host.querySelector('.toast.error')?.textContent).toContain(
        failure === 'read'
          ? '同步读取失败'
          : failure === 'async read'
            ? '异步读取失败'
            : '同步订阅失败',
      );
      expect(host.querySelector('[aria-label="测试正文编辑器"]')).not.toBeNull();
    },
  );
  it('reports a synchronous pin failure and releases pending controls without changing the pin state', async () => {
    await mount(undefined, (api) => {
      api.setStickyPinned = vi.fn(() => {
        throw new Error('同步置顶失败');
      });
    });
    await act(async () => root.render(<App />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="进入便笺模式"]')?.click(),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="便笺始终置顶"]')?.click(),
    );
    const pin = host.querySelector<HTMLButtonElement>('[aria-label="便笺始终置顶"]');
    expect(pin?.getAttribute('aria-pressed')).toBe('true');
    expect(pin?.disabled).toBe(false);
    expect(host.querySelector('.toast.error')?.textContent).toContain('同步置顶失败');
  });
  it('refreshes clean named sessions from disk while preserving tab identity and reading position', async () => {
    const saved = {
      ...asTab(note),
      id: 'stable-tab',
      cursor: 4,
      scrollTop: 230,
      mode: 'source' as const,
    };
    await mount({ tabs: [saved], activeId: saved.id }, (api) => {
      api.openFile = vi.fn(async () => ({
        ...note,
        id: 'disk-id',
        content: '关闭期间的外部修改',
        hash: 'external-hash',
        modifiedAt: 99,
      }));
    });
    expect(api.openFile).toHaveBeenCalledWith(note.path);
    expect(value.tabs[0]).toMatchObject({
      id: saved.id,
      cursor: 4,
      scrollTop: 230,
      mode: 'source',
      content: '关闭期间的外部修改',
      baseContent: '关闭期间的外部修改',
      hash: 'external-hash',
      dirty: false,
    });
  });
  it('keeps dirty named content and unnamed drafts without refreshing over them', async () => {
    const dirty = { ...asTab(note), content: '尚未保存的现场', dirty: true };
    const draft = {
      ...asTab(note),
      id: 'draft',
      path: null,
      content: '空白草稿的记录',
      dirty: true,
    };
    await mount({ tabs: [dirty, draft], activeId: dirty.id });
    expect(api.openFile).not.toHaveBeenCalled();
    expect(value.tabs.map((tab) => tab.content)).toEqual(['尚未保存的现场', '空白草稿的记录']);
  });
  it('keeps the stored original and reports a failed startup refresh', async () => {
    await mount(undefined, (api) => {
      api.openFile = vi.fn(async () => {
        throw new Error('文件暂时不可读');
      });
    });
    expect(value.tabs[0].content).toBe(note.content);
    expect(
      value.notices.some(
        (notice) =>
          notice.message.includes('文件暂时不可读') && notice.message.includes('保留会话原文'),
      ),
    ).toBe(true);
    expect(value.bootstrap).not.toBeNull();
  });
  it('subscribes to initial open requests only after clean-session disk reads finish', async () => {
    let finish: ((note: NoteDocument) => void) | undefined;
    await mount(undefined, (api) => {
      api.openFile = vi.fn(
        () =>
          new Promise<NoteDocument>((resolve) => {
            finish = resolve;
          }),
      );
    });
    expect(value.bootstrap).toBeNull();
    expect(api.onOpenRequested).not.toHaveBeenCalled();
    await act(async () => finish?.(note));
    expect(value.bootstrap).not.toBeNull();
    expect(api.onOpenRequested).toHaveBeenCalledTimes(1);
  });
  it('starts an empty recoverable draft without a pre-created library', async () => {
    await mount({ tabs: [], activeId: null });
    expect(value.tabs).toHaveLength(1);
    expect(value.tabs[0].path).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ tabs: [expect.objectContaining({ path: null, content: '' })] }),
    );
  });
  it('autosaves named notes while retaining the stable tab identifier', async () => {
    await mount();
    await act(async () => value.updateTab(note.id, { content: '中文新内容', dirty: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(api.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({ content: '中文新内容', baseContent: '初始内容', hash: 'hash0' }),
    );
    expect(value.tabs[0].dirty).toBe(false);
    expect(value.tabs[0].id).toBe('note');
  });
  it('keeps a later keystroke dirty when a save completes', async () => {
    await mount();
    let finish: ((outcome: SaveOutcome) => void) | undefined;
    api.saveFile = vi.fn(
      () =>
        new Promise<SaveOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => value.updateTab(note.id, { content: '第一次', dirty: true }));
    let pending: Promise<boolean> | undefined;
    await act(async () => {
      pending = value.save(note.id);
    });
    await act(async () => value.updateTab(note.id, { content: '第一次，第二次', dirty: true }));
    await act(async () => {
      finish?.({ status: 'saved', note: { ...note, content: '第一次', hash: 'h1' } });
      await pending;
    });
    expect(value.tabs[0].content).toBe('第一次，第二次');
    expect(value.tabs[0].baseContent).toBe('第一次');
    expect(value.tabs[0].dirty).toBe(true);
  });
  it('flushes edits made during an earlier save before an explicit operation proceeds', async () => {
    await mount();
    let finish: ((outcome: SaveOutcome) => void) | undefined;
    api.saveFile = vi.fn((request: SaveRequest): Promise<SaveOutcome> => {
      if (request.content === 'A')
        return new Promise((resolve) => {
          finish = resolve;
        });
      return Promise.resolve({
        status: 'saved',
        note: { ...note, content: request.content, hash: 'hash-B' },
      });
    });
    await act(async () => value.updateTab(note.id, { content: 'A', dirty: true }));
    await act(async () => {
      void value.save(note.id);
    });
    await act(async () => value.updateTab(note.id, { content: 'B', dirty: true }));
    let explicit: Promise<boolean> | undefined;
    await act(async () => {
      explicit = value.save(note.id, true);
    });
    await act(async () => {
      finish?.({ status: 'saved', note: { ...note, content: 'A', hash: 'hash-A' } });
      await explicit;
    });
    expect(api.saveFile).toHaveBeenCalledTimes(2);
    expect(api.saveFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'B', baseContent: 'A', hash: 'hash-A' }),
    );
    expect(value.tabs[0].dirty).toBe(false);
    expect(value.tabs[0].baseContent).toBe('B');
  });
  it('flushes the newest named content before a window close acknowledges readiness', async () => {
    await mount();
    let finish: ((outcome: SaveOutcome) => void) | undefined;
    api.saveFile = vi.fn((request: SaveRequest): Promise<SaveOutcome> =>
      request.content === 'A'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({
            status: 'saved',
            note: { ...note, content: request.content, hash: 'hash-B' },
          }),
    );
    await act(async () => value.updateTab(note.id, { content: 'A', dirty: true }));
    await act(async () => {
      void value.save(note.id);
    });
    await act(async () => value.updateTab(note.id, { content: 'B', dirty: true }));
    await act(async () => onClose());
    await act(async () => {
      finish?.({ status: 'saved', note: { ...note, content: 'A', hash: 'hash-A' } });
    });
    expect(api.saveFile).toHaveBeenCalledTimes(2);
    expect(value.tabs[0].dirty).toBe(false);
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: [expect.objectContaining({ content: 'B', baseContent: 'B', dirty: false })],
      }),
    );
    expect(api.closeReady).toHaveBeenCalledTimes(1);
  });
  it('retains both conflicting sources as a disk version and independent draft', async () => {
    await mount();
    api.saveFile = vi.fn(async (): Promise<SaveOutcome> => ({
      status: 'conflict',
      conflict: {
        path: note.path!,
        base: note.content,
        ours: '本地内容',
        theirs: '外部内容',
        hash: 'external',
      },
    }));
    await act(async () => value.updateTab(note.id, { content: '本地内容', dirty: true }));
    await act(async () => {
      await value.save(note.id, true);
    });
    expect(value.conflict).not.toBeNull();
    await act(async () => value.keepBoth());
    expect(value.tabs.find((tab) => tab.path === note.path)?.content).toBe('外部内容');
    expect(value.tabs.find((tab) => !tab.path)?.content).toBe('本地内容');
    expect(value.conflict).toBeNull();
  });
  it('keeps the window and unsaved content on save failure', async () => {
    await mount();
    api.saveFile = vi.fn(async () => {
      throw new Error('磁盘不可写');
    });
    await act(async () => value.updateTab(note.id, { content: '必须保留', dirty: true }));
    await act(async () => onClose());
    expect(api.closeReady).not.toHaveBeenCalled();
    expect(value.tabs[0].content).toBe('必须保留');
    expect(value.tabs[0].dirty).toBe(true);
    expect(value.closing).toBe(false);
  });
  it('persists unnamed drafts before acknowledging a window close', async () => {
    await mount({ tabs: [], activeId: null });
    await act(async () =>
      value.updateTab(value.tabs[0].id, { content: '尚未命名的记录', dirty: true }),
    );
    await act(async () => onClose());
    expect(api.saveFile).not.toHaveBeenCalled();
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: [expect.objectContaining({ content: '尚未命名的记录', path: null })],
      }),
    );
    expect(api.closeReady).toHaveBeenCalledTimes(1);
  });
  it('refuses to close if session persistence fails', async () => {
    await mount();
    api.saveSession = vi.fn(async () => {
      throw new Error('数据目录不可写');
    });
    await act(async () => onClose());
    expect(api.closeReady).not.toHaveBeenCalled();
    expect(value.closing).toBe(false);
    expect(value.notices.some((notice) => notice.message.includes('数据目录不可写'))).toBe(true);
  });
  it('names its settings dialog and restores the appearance snapshot', async () => {
    await mount();
    function SettingsHarness() {
      const [settings, setSettings] = useState(structuredClone(defaultSettings));
      return (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          fonts={[]}
          onFonts={() => undefined}
          onError={() => undefined}
          dataDirectory="D:\\data"
          version="test"
          onClose={() => undefined}
          saveState="设置已保存"
        />
      );
    }
    await act(async () => root.render(<SettingsHarness />));
    const dialog = host.querySelector('dialog');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    const mode = host.querySelector<HTMLSelectElement>('[aria-label="明暗模式"]');
    if (!mode) throw new Error('missing appearance mode field');
    await act(async () => {
      mode.value = 'dark';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(mode.value).toBe('dark');
    const undo = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('撤销本次外观修改'),
    );
    await act(async () => undo?.click());
    expect(mode.value).toBe('light');
  });
  it('treats a cancelled wallpaper picker as cancellation', async () => {
    await mount();
    await act(async () =>
      root.render(
        <SettingsPanel
          settings={structuredClone(defaultSettings)}
          onChange={() => undefined}
          fonts={[]}
          onFonts={() => undefined}
          onError={() => undefined}
          dataDirectory="D:\\data"
          version="test"
          onClose={() => undefined}
          saveState="设置已保存"
        />,
      ),
    );
    const choose = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('选择图片'),
    );
    await act(async () => choose?.click());
    expect(api.chooseWallpaper).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('已取消，未作修改');
  });
  it('keeps opening a daily note separate from writing an additional entry', async () => {
    await mount();
    const onJournal = vi.fn();
    await act(async () =>
      root.render(
        <Sidebar
          settings={structuredClone(defaultSettings)}
          trees={{}}
          index={[]}
          activePath={null}
          onSettings={() => undefined}
          onOpen={() => undefined}
          onNew={() => undefined}
          onJournal={onJournal}
          onError={() => undefined}
        />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll('button')].find((button) => button.textContent === '日历')?.click(),
    );
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('打开 / 新建日记'))
        ?.click(),
    );
    expect(onJournal).toHaveBeenLastCalledWith('daily', expect.any(String));
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('按模板另写一篇'))
        ?.click(),
    );
    expect(onJournal).toHaveBeenLastCalledWith('daily', expect.any(String), undefined, true);
  });
  it('retains the additional-entry flag through template selection and opens its own tab', async () => {
    await mount();
    const settings = structuredClone(defaultSettings);
    settings.journalDirectory = 'D:\\日记';
    settings.templates.push({
      id: 'daily-second',
      name: '日记第二模板',
      kind: 'daily',
      content: '# {{date}}\n第二种记录方式',
    });
    api.bootstrap = vi.fn(async () => ({
      settings,
      session: { tabs: [asTab(note)], activeId: note.id },
      fonts: [],
      dataDirectory: 'D:\\data',
      version: 'test',
    }));
    api.periodicNote = vi.fn(async () => ({
      ...note,
      id: 'additional',
      path: 'D:\\日记\\2026-10-22-2.md',
      title: '另写的日记',
    }));
    await act(async () => root.render(<App />));
    await act(async () =>
      [...host.querySelectorAll('button')].find((button) => button.textContent === '日历')?.click(),
    );
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('按模板另写一篇'))
        ?.click(),
    );
    expect(api.periodicNote).not.toHaveBeenCalled();
    const template = host.querySelector<HTMLSelectElement>('[aria-label="新笔记模板"]');
    if (!template) throw new Error('missing periodic-note template selector');
    await act(async () => {
      template.value = 'daily-second';
      template.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === '创建笔记')
        ?.click(),
    );
    expect(api.periodicNote).toHaveBeenCalledWith(
      'daily',
      expect.any(String),
      'daily-second',
      true,
    );
    expect(
      [...host.querySelectorAll('[role="tab"]')].some(
        (tab) =>
          tab.textContent?.includes('另写的日记') && tab.getAttribute('aria-selected') === 'true',
      ),
    ).toBe(true);
  });
  it('opens a saved standalone Markdown link without adding a directory and locates its heading', async () => {
    await mount();
    const source = { ...note, content: '[另一篇](另一篇.md#目标)' };
    const settings = structuredClone(defaultSettings);
    settings.autoSave = false;
    api.bootstrap = vi.fn(async () => ({
      settings,
      session: { tabs: [asTab(source)], activeId: source.id },
      fonts: [],
      dataDirectory: 'D:\\data',
      version: 'test',
    }));
    api.openLinkedFile = vi.fn(async () => ({
      ...note,
      id: 'linked',
      path: 'D:\\notes\\另一篇.md',
      title: '另一篇',
      content: '# 另一篇\n\n## 目标\n目标内容',
    }));
    await act(async () => root.render(<App />));
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === '打开测试相对链接')
        ?.click(),
    );
    expect(api.openLinkedFile).toHaveBeenCalledWith(source.path, '另一篇.md#目标');
    expect(
      [...host.querySelectorAll('[role="tab"]')].some(
        (tab) =>
          tab.textContent?.includes('另一篇') && tab.getAttribute('aria-selected') === 'true',
      ),
    ).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(editorCalls.scrollToLine).toHaveBeenCalledWith(3);
    expect(api.saveFile).not.toHaveBeenCalled();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });
  it('asks to save a newly written standalone link without saving or authorizing it automatically', async () => {
    await mount();
    const source = {
      ...asTab(note),
      content: `${note.content}\n[另一篇](另一篇.md#目标)`,
      dirty: true,
    };
    const settings = structuredClone(defaultSettings);
    settings.autoSave = false;
    api.bootstrap = vi.fn(async () => ({
      settings,
      session: { tabs: [source], activeId: source.id },
      fonts: [],
      dataDirectory: 'D:\\data',
      version: 'test',
    }));
    await act(async () => root.render(<App />));
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === '打开测试相对链接')
        ?.click(),
    );
    expect(api.openLinkedFile).not.toHaveBeenCalled();
    expect(api.saveFile).not.toHaveBeenCalled();
    expect(host.textContent).toContain('请先保存笔记再打开');
  });
  it('inserts a relative link into the original editor selection and leaves cancellation unchanged', async () => {
    await mount();
    const source = { ...note, content: '前文 选中文字 后文' };
    const settings = structuredClone(defaultSettings);
    settings.autoSave = false;
    api.bootstrap = vi.fn(async () => ({
      settings,
      session: { tabs: [asTab(source)], activeId: source.id },
      fonts: [],
      dataDirectory: 'D:\\data',
      version: 'test',
    }));
    api.openFile = vi.fn(async () => source);
    api.getIndex = vi.fn(async () => [
      {
        path: 'D:\\notes\\sub\\目标.md',
        title: '目标笔记',
        tags: [],
        headings: [],
        links: [],
        modifiedAt: 1,
      },
    ]);
    editorCalls.from = 3;
    editorCalls.to = 7;
    await act(async () => root.render(<App />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="链接"]')?.click(),
    );
    expect(host.querySelector<HTMLInputElement>('[aria-label="链接显示文字"]')?.value).toBe(
      '选中文字',
    );
    await act(async () =>
      [...host.querySelectorAll('button')].find((button) => button.textContent === '取消')?.click(),
    );
    expect(editorCalls.insert).not.toHaveBeenCalled();
    expect(editorCalls.dispatch).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="链接"]')?.click(),
    );
    await act(async () =>
      [...host.querySelectorAll('.link-target-list button')]
        .find((button) => button.textContent?.includes('目标笔记'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(host.querySelector<HTMLInputElement>('[aria-label="链接目标"]')?.value).toBe(
      'sub/目标.md',
    );
    await act(async () =>
      host
        .querySelector<HTMLFormElement>('dialog form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(editorCalls.dispatch).toHaveBeenCalledWith({ selection: { anchor: 3, head: 7 } });
    expect(editorCalls.insert).toHaveBeenCalledWith('[选中文字](sub/目标.md)');
    expect(api.saveFile).not.toHaveBeenCalled();
  });
  it.each(['\r\n', '\r'])(
    'inserts a link into unchanged %j text using editor positions',
    async (ending) => {
      await mount();
      const source = { ...note, content: ['首行', '选中词', '末段'].join(ending) };
      const settings = { ...structuredClone(defaultSettings), autoSave: false };
      api.bootstrap = vi.fn(async () => ({
        settings,
        session: { tabs: [asTab(source)], activeId: source.id },
        fonts: [],
        dataDirectory: 'D:\\data',
        version: 'test',
      }));
      api.openFile = vi.fn(async () => source);
      editorCalls.from = 3;
      editorCalls.to = 6;
      await act(async () => root.render(<App />));
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="链接"]')?.click());
      const target = host.querySelector<HTMLInputElement>('[aria-label="链接目标"]');
      if (!target) throw new Error('missing link target');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          target,
          'https://example.com/',
        );
        target.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        host
          .querySelector<HTMLFormElement>('dialog form')
          ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      expect(editorCalls.insert).toHaveBeenCalledWith('[选中词](https://example.com/)');
      expect(editorCalls.dispatch).toHaveBeenCalledWith({ selection: { anchor: 3, head: 6 } });
      expect(api.saveFile).not.toHaveBeenCalled();
    },
  );
  it.each([
    { savedContent: '首行\r\n选中词\r\n末段', allowed: true },
    { savedContent: '首行\n正文已改变\n末段', allowed: false },
  ])(
    'rechecks a save reply during link selection without rejecting line endings: $allowed',
    async ({ savedContent, allowed }) => {
      await mount();
      const source = { ...note, content: '首行\n选中词\n末段' };
      const settings = { ...structuredClone(defaultSettings), autoSave: false };
      api.bootstrap = vi.fn(async () => ({
        settings,
        session: { tabs: [asTab(source)], activeId: source.id },
        fonts: [],
        dataDirectory: 'D:\\data',
        version: 'test',
      }));
      api.openFile = vi.fn(async () => source);
      let finish!: (outcome: SaveOutcome) => void;
      api.saveFile = vi.fn(
        () =>
          new Promise<SaveOutcome>((resolve) => {
            finish = resolve;
          }),
      );
      editorCalls.from = 3;
      editorCalls.to = 6;
      await act(async () => root.render(<App />));
      await act(async () => host.querySelector<HTMLButtonElement>('.save-button')?.click());
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="链接"]')?.click());
      await act(async () =>
        finish({ status: 'saved', note: { ...source, content: savedContent, hash: 'saved' } }),
      );
      const target = host.querySelector<HTMLInputElement>('[aria-label="链接目标"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          target,
          'https://example.com/',
        );
        target.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        host
          .querySelector<HTMLFormElement>('dialog form')
          ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      if (allowed)
        expect(editorCalls.insert).toHaveBeenCalledWith('[选中词](https://example.com/)');
      else {
        expect(editorCalls.insert).not.toHaveBeenCalled();
        expect(host.textContent).toContain('正文发生了变化');
      }
    },
  );
  it('shows Chinese operation tooltips and the configured shortcut on keyboard focus', async () => {
    await mount();
    await act(async () =>
      root.render(
        <OperationContext.Provider
          value={{ busy: '', notice: null, shortcuts: { settings: 'Ctrl+Alt+p' } }}
        >
          <IconButton label="打开设置">
            <span>设置</span>
          </IconButton>
        </OperationContext.Provider>,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>('[aria-label="打开设置"]');
    await act(async () => button?.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      '打开设置 · Ctrl+Alt+p',
    );
    await act(async () => button?.blur());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
  it('keeps the source mode switch next to the save state when formatting controls are hidden', async () => {
    await mount();
    const settings = { ...structuredClone(defaultSettings), toolbarVisible: false };
    api.bootstrap = vi.fn(async () => ({
      settings,
      session: { tabs: [asTab(note)], activeId: note.id },
      fonts: [],
      dataDirectory: 'D:\\data',
      version: 'test',
    }));
    await act(async () => root.render(<App />));
    expect(host.querySelector('.editor-toolbar')).toBeNull();
    const mode = host.querySelector<HTMLButtonElement>('.document-actions .mode-button')!;
    expect(mode.textContent).toBe('即时排版');
    await act(async () => mode.click());
    expect(mode.textContent).toBe('源码');
  });
  it('focuses the note menu, moves to its last action and restores the trigger with Escape', async () => {
    await mount();
    await act(async () => root.render(<App />));
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="笔记操作菜单"]')!;
    await act(async () => {
      trigger.focus();
      trigger.click();
    });
    const menu = host.querySelector('[role="menu"][aria-label="笔记操作"]')!;
    expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'));
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe([...menu.querySelectorAll('[role="menuitem"]')].at(-1));
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(host.querySelector('[aria-label="笔记操作"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('cycles note tabs with arrows and Ctrl+Tab while Ctrl+W protects an unsaved draft', async () => {
    const draft = {
      ...asTab(note),
      id: 'second',
      title: '第二份草稿',
      path: null,
      content: '必须保留的草稿',
      dirty: true,
    };
    await mount({ tabs: [asTab(note), draft], activeId: note.id });
    await act(async () => root.render(<App />));
    const current = host.querySelector<HTMLButtonElement>(
      '.tabs-bar [role="tab"][aria-selected="true"]',
    )!;
    await act(async () => {
      current.focus();
      current.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toContain('第二份草稿');
    expect(
      host.querySelector('.tabs-bar [role="tab"][aria-selected="true"]')?.textContent,
    ).toContain('第二份草稿');
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(
      host.querySelector('.tabs-bar [role="tab"][aria-selected="true"]')?.textContent,
    ).toContain('学习');
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('dialog')?.textContent).toContain('第二份草稿');
    expect(
      host.querySelector('.tabs-bar [role="tab"][aria-selected="true"]')?.textContent,
    ).toContain('第二份草稿');
  });
  it('moves sidebar navigation with arrow keys and keeps one tab in the focus order', async () => {
    await mount();
    await act(async () => root.render(<App />));
    const first = host.querySelector<HTMLButtonElement>('.sidebar-switch [role="tab"]')!;
    await act(async () => {
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('搜索');
    expect(host.querySelectorAll('.sidebar-switch [role="tab"][tabindex="0"]')).toHaveLength(1);
  });
  it('protects unsubmitted modal input and restores focus after an explicit discard', async () => {
    await mount();
    const trigger = document.createElement('button');
    trigger.textContent = '原入口';
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <Modal title="未提交表单" onClose={onClose} pending>
          <input aria-label="输入" />
        </Modal>,
      ),
    );
    await act(async () =>
      host.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(host.textContent).toContain('还有未提交的输入');
    expect(document.activeElement?.textContent).toBe('继续编辑');
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === '放弃输入并关闭')
        ?.click(),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
  it('keeps a busy modal open and allows ordinary dismissal once the operation finishes', async () => {
    await mount();
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <Modal title="处理中" onClose={onClose} busy>
          <p>本地操作</p>
        </Modal>,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')?.click(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(host.textContent).toContain('请等待完成后关闭');
    await act(async () =>
      root.render(
        <Modal title="处理中" onClose={onClose}>
          <p>本地操作</p>
        </Modal>,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')?.click(),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('preserves sidebar context across manual hiding and remembers right-group expansion', async () => {
    await mount();
    await act(async () => root.render(<App />));
    await act(async () =>
      [...host.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.textContent === '日历')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="收起左侧导航"]')?.click(),
    );
    expect(host.querySelector<HTMLElement>('.left-sidebar')?.hidden).toBe(true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="显示左侧导航"]')?.click(),
    );
    expect(
      [...host.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.textContent === '日历')
        ?.getAttribute('aria-selected'),
    ).toBe('true');
    const group = host.querySelector<HTMLButtonElement>('[aria-controls="right-backlinks"]');
    expect(group?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => group?.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(api.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ rightGroups: expect.objectContaining({ backlinks: true }) }),
    );
  });
  it('expires ordinary success notices while retaining failures', async () => {
    await mount();
    await act(async () => root.render(<App />));
    await act(async () => host.querySelector<HTMLButtonElement>('.save-button')?.click());
    expect(host.querySelector('.toast')?.textContent).toContain('已保存');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3900);
    });
    expect(host.querySelector('.toast')).toBeNull();
    api.saveFile = vi.fn(async () => {
      throw new Error('磁盘拒绝写入');
    });
    await act(async () => host.querySelector<HTMLButtonElement>('.save-button')?.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3900);
    });
    expect(host.querySelector('.toast.error')?.textContent).toContain('磁盘拒绝写入');
  });
  it('keeps the mounted editor and sidebar context when entering and leaving sticky mode without changing layout preferences', async () => {
    await mount();
    await act(async () => root.render(<App />));
    await act(async () =>
      [...host.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.textContent === '日历')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    const originalEditor = host.querySelector('[aria-label="测试正文编辑器"]');
    const originalSidebar = host.querySelector('.left-sidebar');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="进入便笺模式"]')?.click(),
    );
    expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('sticky');
    expect(host.querySelector('[aria-label="测试正文编辑器"]')).toBe(originalEditor);
    expect(host.querySelector('.left-sidebar')).toBe(originalSidebar);
    expect(host.querySelector<HTMLElement>('.left-sidebar')?.hidden).toBe(true);
    expect(
      host
        .querySelector<HTMLButtonElement>('[aria-label="便笺始终置顶"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="便笺始终置顶"]')?.click(),
    );
    expect(api.setStickyPinned).toHaveBeenCalledWith(false);
    expect(
      host
        .querySelector<HTMLButtonElement>('[aria-label="便笺始终置顶"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="返回完整窗口"]')?.click(),
    );
    expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('full');
    expect(host.querySelector('[aria-label="测试正文编辑器"]')).toBe(originalEditor);
    expect(
      [...host.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.textContent === '日历')
        ?.getAttribute('aria-selected'),
    ).toBe('true');
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(api.saveFile).not.toHaveBeenCalled();
  });
  it('waits for the full window before a sticky settings shortcut opens its panel', async () => {
    let finishFull: ((state: WindowModeState) => void) | undefined;
    await mount(undefined, (api) => {
      api.setWindowMode = vi.fn(async (mode) =>
        mode === 'sticky'
          ? { mode, pinned: true }
          : new Promise<WindowModeState>((resolve) => {
              finishFull = resolve;
            }),
      );
    });
    await act(async () => root.render(<App />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="进入便笺模式"]')?.click(),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }),
      ),
    );
    expect(api.setWindowMode).toHaveBeenLastCalledWith('full');
    expect(host.querySelector('dialog')).toBeNull();
    expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('sticky');
    expect(host.textContent).toContain('正在调整窗口');
    await act(async () => finishFull?.({ mode: 'full', pinned: false }));
    expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('full');
    expect(host.querySelector('dialog')?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(host.querySelector('dialog')?.textContent).toContain('设置');
  });
  it('retains sticky mode and content when returning full fails, and handles external mode events', async () => {
    let modeChanged: ((state: WindowModeState) => void) | undefined;
    await mount(undefined, (api) => {
      api.onWindowModeChanged = vi.fn((callback) => {
        modeChanged = callback;
        return () => {};
      });
      api.setWindowMode = vi.fn(async (mode) => {
        if (mode === 'full') throw new Error('窗口切换被拒绝');
        return { mode, pinned: true };
      });
    });
    await act(async () => root.render(<App />));
    const originalEditor = host.querySelector('[aria-label="测试正文编辑器"]');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="进入便笺模式"]')?.click(),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }),
      ),
    );
    expect(host.querySelector('dialog')).toBeNull();
    expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('sticky');
    expect(host.querySelector('.toast.error')?.textContent).toContain('窗口切换被拒绝');
    expect(host.querySelector('[aria-label="测试正文编辑器"]')).toBe(originalEditor);
    await act(async () => modeChanged?.({ mode: 'full', pinned: false }));
    expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('full');
    expect(host.querySelector('[aria-label="测试正文编辑器"]')).toBe(originalEditor);
    expect(api.saveFile).not.toHaveBeenCalled();
  });
  it('switches opened notes from the sticky title menu and keeps ordinary editing actions in the same window', async () => {
    const second = {
      ...asTab(note),
      id: 'second',
      title: '第二篇',
      path: null,
      content: '第二篇正文',
    };
    await mount({ tabs: [asTab(note), second], activeId: note.id });
    await act(async () => root.render(<App />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="进入便笺模式"]')?.click(),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="切换便笺笔记"]')?.click(),
    );
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('[aria-label="便笺笔记"] [role="menuitem"]')]
        .find((item) => item.textContent?.includes('第二篇'))
        ?.click(),
    );
    expect(host.querySelector('.sticky-title')?.textContent).toContain('第二篇');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="便笺更多操作"]')?.click(),
    );
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('[aria-label="便笺操作"] [role="menuitem"]')]
        .find((item) => item.textContent === '新建空白笔记')
        ?.click(),
    );
    expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('sticky');
    expect(api.setWindowMode).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.sticky-title')?.textContent).toContain('未命名');
  });
  it('coalesces repeated sticky entry and opens a draft when no note is active', async () => {
    let finishSticky: ((state: WindowModeState) => void) | undefined;
    await mount({ tabs: [], activeId: null }, (api) => {
      api.setWindowMode = vi.fn(
        () =>
          new Promise<WindowModeState>((resolve) => {
            finishSticky = resolve;
          }),
      );
    });
    await act(async () => root.render(<App />));
    const enter = host.querySelector<HTMLButtonElement>('[aria-label="进入便笺模式"]');
    await act(async () => {
      enter?.click();
      enter?.click();
    });
    expect(api.setWindowMode).toHaveBeenCalledTimes(1);
    await act(async () => finishSticky?.({ mode: 'sticky', pinned: true }));
    expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('sticky');
    expect(host.querySelector('[aria-label="测试正文编辑器"]')).not.toBeNull();
    expect(host.querySelector('.sticky-title')?.textContent).toContain('未命名');
    expect(api.saveFile).not.toHaveBeenCalled();
  });
});
