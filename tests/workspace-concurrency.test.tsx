// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopAPI,
  FileEntry,
  NoteDocument,
  NoteMeta,
  SaveOutcome,
  SaveRequest,
} from '../src/shared/types';
import { defaultSettings } from '../src/shared/defaults';
import { asTab } from '../src/ui/model';
import { useWorkspace } from '../src/ui/useWorkspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const note: NoteDocument = {
  id: 'note',
  path: 'D:\\fixture\\note.md',
  title: 'note',
  content: 'A\nmiddle\nB\n',
  hash: 'initial',
  modifiedAt: 1,
};
type WorkspaceAPI = Pick<
  DesktopAPI,
  | 'bootstrap'
  | 'openFile'
  | 'saveFile'
  | 'saveSettings'
  | 'saveSession'
  | 'getIndex'
  | 'getTree'
  | 'onFilesChanged'
  | 'onCloseRequested'
  | 'onOpenRequested'
  | 'onProgress'
  | 'closeReady'
>;
let root: Root;
let host: HTMLDivElement;
let workspace: ReturnType<typeof useWorkspace>;
let filesChanged: (paths: string[]) => void;
let closeRequested: () => void;
let api: WorkspaceAPI;
function Harness() {
  workspace = useWorkspace();
  return null;
}
async function mount(autoSave = false) {
  const settings = { ...structuredClone(defaultSettings), autoSave };
  api = {
    bootstrap: vi.fn(async () => ({
      settings,
      session: { tabs: [asTab(note)], activeId: note.id },
      fonts: [],
      dataDirectory: 'memory-only',
      version: 'test',
    })),
    openFile: vi.fn(async () => note),
    saveFile: vi.fn(async (request: SaveRequest): Promise<SaveOutcome> => ({
      status: 'saved',
      note: { ...note, content: request.content, hash: 'saved' },
    })),
    saveSettings: vi.fn(async (next) => next),
    saveSession: vi.fn(async () => undefined),
    getIndex: vi.fn(async () => []),
    getTree: vi.fn(async () => []),
    onFilesChanged: (callback) => {
      filesChanged = callback;
      return () => {};
    },
    onCloseRequested: (callback) => {
      closeRequested = callback;
      return () => {};
    },
    onOpenRequested: () => () => {},
    onProgress: () => () => {},
    closeReady: vi.fn(async () => undefined),
  };
  Reflect.set(window, 'notes', api);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.useRealTimers();
});

describe('workspace save and external change coordination', () => {
  it('keeps newer directory results when a refresh for old roots finishes last', async () => {
    await mount();
    const oldRoot = 'D:\\generated\\old';
    const newRoot = 'D:\\generated\\new';
    const initial = workspace.settings!;
    await act(async () => workspace.setSettings({ ...initial, roots: [oldRoot] }));
    const indexes: Array<(notes: NoteMeta[]) => void> = [];
    const trees: Array<{ path: string; finish(entries: FileEntry[]): void }> = [];
    api.getIndex = vi.fn(() => new Promise<NoteMeta[]>((resolve) => indexes.push(resolve)));
    api.getTree = vi.fn(
      (path) => new Promise<FileEntry[]>((finish) => trees.push({ path, finish })),
    );
    let oldRefresh!: Promise<void>;
    await act(async () => {
      oldRefresh = workspace.refresh();
    });
    await act(async () => workspace.setSettings({ ...initial, roots: [newRoot] }));
    expect(indexes).toHaveLength(2);
    const meta = (root: string): NoteMeta => ({
      path: `${root}\\note.md`,
      title: root,
      tags: [],
      headings: [],
      links: [],
      modifiedAt: 1,
    });
    const entry = (root: string): FileEntry => ({
      path: `${root}\\note.md`,
      name: 'note.md',
      kind: 'note',
    });
    await act(async () => {
      indexes[1]([meta(newRoot)]);
      trees[1].finish([entry(newRoot)]);
    });
    await act(async () => {
      indexes[0]([meta(oldRoot)]);
      trees[0].finish([entry(oldRoot)]);
      await oldRefresh;
    });
    expect(workspace.index.map((item) => item.path)).toEqual([`${newRoot}\\note.md`]);
    expect(Object.keys(workspace.trees)).toEqual([newRoot]);
  });
  it('rebases typing made during a merged save before a later save writes it', async () => {
    await mount();
    let finish!: (outcome: SaveOutcome) => void;
    let disk = 'Local1\nmiddle\nExternal\n';
    api.saveFile = vi.fn(async (request: SaveRequest): Promise<SaveOutcome> => {
      if (request.content === 'Local1\nmiddle\nB\n')
        return new Promise<SaveOutcome>((resolve) => {
          finish = resolve;
        });
      disk = request.content;
      return { status: 'saved', note: { ...note, content: disk, hash: 'latest' } };
    });
    await act(async () =>
      workspace.updateTab(note.id, { content: 'Local1\nmiddle\nB\n', dirty: true }),
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = workspace.save(note.id);
    });
    await act(async () =>
      workspace.updateTab(note.id, { content: 'Local2\nmiddle\nB\n', dirty: true }),
    );
    await act(async () => {
      finish({ status: 'saved', merged: true, note: { ...note, content: disk, hash: 'merged' } });
      await pending;
    });
    expect(workspace.tabs[0].content).toBe('Local2\nmiddle\nExternal\n');
    expect(workspace.tabs[0].dirty).toBe(true);
    await act(async () => {
      await workspace.save(note.id, true);
    });
    expect(disk).toBe('Local2\nmiddle\nExternal\n');
    expect(workspace.tabs[0].dirty).toBe(false);
  });

  it('keeps all versions when later typing conflicts with the completed merge, then protects further edits', async () => {
    await mount(true);
    const submitted = 'Local1\nmiddle\nB\n';
    const ours = 'Local2\nmiddle\nTyped later\n';
    const theirs = 'Local1\nmiddle\nExternal\n';
    let finish!: (outcome: SaveOutcome) => void;
    api.saveFile = vi.fn(
      () =>
        new Promise<SaveOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => workspace.updateTab(note.id, { content: submitted, dirty: true }));
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = workspace.save(note.id);
    });
    await act(async () => workspace.updateTab(note.id, { content: ours, dirty: true }));
    await act(async () => {
      finish({ status: 'saved', merged: true, note: { ...note, content: theirs, hash: 'merged' } });
    });
    expect(await pending).toBe(false);
    expect(workspace.conflict?.detail).toMatchObject({
      base: submitted,
      ours,
      theirs,
      hash: 'merged',
    });
    const newest = `${ours}extra typing\n`;
    await act(async () => workspace.updateTab(note.id, { content: newest, dirty: true }));
    await act(async () => {
      filesChanged([note.path!]);
      closeRequested();
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.saveFile).toHaveBeenCalledTimes(1);
    expect(api.closeReady).not.toHaveBeenCalled();
    expect(workspace.tabs[0].content).toBe(newest);
    await act(async () => workspace.keepBoth());
    expect(workspace.tabs.find((tab) => tab.path === note.path)?.content).toBe(theirs);
    expect(workspace.tabs.find((tab) => tab.path === null)?.content).toBe(newest);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.saveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: expect.arrayContaining([expect.objectContaining({ path: null, content: newest })]),
      }),
    );
  });

  it('does not save dirty notes on external events when autoSave is disabled, while preserving the draft', async () => {
    await mount();
    await act(async () =>
      workspace.updateTab(note.id, { content: 'unsaved local content', dirty: true }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      filesChanged([note.path!]);
    });
    expect(api.saveFile).not.toHaveBeenCalled();
    expect(workspace.tabs[0]).toMatchObject({ content: 'unsaved local content', dirty: true });
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: [expect.objectContaining({ content: 'unsaved local content', dirty: true })],
      }),
    );
    await act(async () => {
      await workspace.save(note.id, true);
    });
    expect(workspace.tabs[0].dirty).toBe(false);
  });

  it('ignores a stale external read after a newer read has refreshed the clean note', async () => {
    await mount();
    const reads: ((value: NoteDocument) => void)[] = [];
    api.openFile = vi.fn(() => new Promise<NoteDocument>((resolve) => reads.push(resolve)));
    await act(async () => {
      filesChanged([note.path!]);
      filesChanged([note.path!]);
    });
    await act(async () => reads[1]({ ...note, content: 'newer version', hash: 'newer' }));
    await act(async () => reads[0]({ ...note, content: 'older version', hash: 'older' }));
    expect(workspace.tabs[0]).toMatchObject({
      content: 'newer version',
      baseContent: 'newer version',
      hash: 'newer',
      dirty: false,
    });
  });

  it('ignores an external read that finishes after a newer local save', async () => {
    await mount();
    let finish!: (value: NoteDocument) => void;
    api.openFile = vi.fn(
      () =>
        new Promise<NoteDocument>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => filesChanged([note.path!]));
    await act(async () =>
      workspace.updateTab(note.id, { content: 'new local version', dirty: true }),
    );
    await act(async () => {
      await workspace.save(note.id, true);
    });
    await act(async () => finish({ ...note, content: 'stale disk version' }));
    expect(workspace.tabs[0]).toMatchObject({
      content: 'new local version',
      hash: 'saved',
      dirty: false,
    });
  });
});
