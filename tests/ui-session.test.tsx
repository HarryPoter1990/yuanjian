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
} from '../src/shared/types';
import { defaultSettings } from '../src/shared/defaults';
import { asTab } from '../src/ui/model';
import { useWorkspace } from '../src/ui/useWorkspace';
import { SettingsPanel } from '../src/components/SettingsPanel';
import { Sidebar } from '../src/components/Sidebar';
import App from '../src/App';

vi.mock('../src/editor/MarkdownEditor', () => ({
  MarkdownEditor: () => <div aria-label="测试正文编辑器" />,
}));
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
    bootstrap: vi.fn(async () => ({
      settings,
      session,
      fonts: [],
      dataDirectory: 'D:\\data',
      version: 'test',
    })),
    saveSettings: vi.fn(async (next) => next),
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
    moveFile: vi.fn(async () => null),
    undoMove: vi.fn(async () => undefined),
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
async function mount(session: SessionState = { tabs: [asTab(note)], activeId: note.id }) {
  api = makeAPI(session);
  window.notes = api;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
}
beforeEach(() => {
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
});
