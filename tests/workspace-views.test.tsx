// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspace } from '../src/ui/useWorkspace';
import { defaultSettings } from '../src/shared/defaults';
import { asTab } from '../src/ui/model';
import type { SessionState, ViewTab } from '../src/shared/types';

let workspace: ReturnType<typeof useWorkspace>, host: HTMLDivElement, root: Root;
const tabs = ['A', 'B', 'C'].map((id) =>
  asTab({
    id,
    path: `D:/generated/${id}.md`,
    title: id,
    content: `${id} content`,
    hash: id,
    modifiedAt: 1,
  }),
);
const api = {
  bootstrap: vi.fn(),
  openFile: vi.fn(async (path: string) => tabs.find((tab) => tab.path === path) || null),
  centerWindow: vi.fn(async () => {}),
  getIndex: async () => [],
  getTree: async () => [],
  saveSettings: async (settings: typeof defaultSettings) => settings,
  saveSession: vi.fn(async (_session: SessionState) => {}),
  onFilesChanged: () => () => {},
  onCloseRequested: () => () => {},
  onOpenRequested: () => () => {},
  onProgress: () => () => {},
};
function Harness() {
  workspace = useWorkspace();
  return null;
}
async function mount(session: SessionState = { tabs, activeId: 'B' }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.saveSession.mockClear();
  api.openFile.mockClear();
  api.centerWindow.mockReset().mockResolvedValue(undefined);
  api.bootstrap.mockResolvedValue({
    settings: { ...structuredClone(defaultSettings), autoSave: false },
    session: structuredClone(session),
    fonts: [],
    dataDirectory: 'memory',
    version: 'test',
  });
  Reflect.set(window, 'notes', api);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

it('centers only a newly opened active file, without moving on existing selection, draft creation or refresh', async () => {
  await mount();
  expect(api.centerWindow).not.toHaveBeenCalled();
  const opened = { ...tabs[0], id: 'new-file', path: 'D:/generated/New.md', title: 'New' };
  api.openFile.mockResolvedValueOnce(opened);
  await act(async () => {
    expect(await workspace.open(opened.path)).toBe('new-file');
  });
  expect(api.centerWindow).toHaveBeenCalledTimes(1);
  await act(async () => {
    await workspace.open(opened.path);
    workspace.newDraft();
    await workspace.refresh();
  });
  expect(api.centerWindow).toHaveBeenCalledTimes(1);
});
it('keeps a successfully opened document when centering fails and reports the separate failure', async () => {
  await mount();
  const opened = { ...tabs[0], id: 'center-failed', path: 'D:/generated/Center.md' };
  api.openFile.mockResolvedValueOnce(opened);
  api.centerWindow.mockRejectedValueOnce(Error('generated centering failure'));
  await act(async () => {
    expect(await workspace.open(opened.path)).toBe(opened.id);
  });
  expect(workspace.activeId).toBe(opened.id);
  expect(workspace.tabs.some((tab) => tab.id === opened.id)).toBe(true);
  expect(workspace.notices.map((notice) => notice.message).join('\n')).toContain('窗口未能居中');
});

it('does not center after a cancelled picker or after the newly opened note has moved to the background', async () => {
  await mount();
  api.openFile.mockResolvedValueOnce(null);
  await act(async () => {
    expect(await workspace.open()).toBeNull();
  });
  await act(async () => {
    workspace.openDocument({ ...tabs[0], id: 'background', path: 'D:/generated/Background.md' });
    workspace.setActiveId('B');
  });
  expect(api.centerWindow).not.toHaveBeenCalled();
  expect(workspace.activeId).toBe('B');
});

it('inserts a new note to the right of the active note without moving already open notes', async () => {
  await mount();
  let id = '';
  await act(async () => {
    id = workspace.newDraft('new content', 'new');
  });
  expect(workspace.tabs.map((tab) => tab.id)).toEqual(['A', 'B', id, 'C']);
  await act(async () => {
    await workspace.open(tabs[0].path!);
  });
  expect(workspace.tabs.map((tab) => tab.id)).toEqual(['A', 'B', id, 'C']);
  expect(workspace.activeId).toBe('A');
});
it('restores and persists a mixed note/graph order and keeps selection while reordering', async () => {
  await mount({
    tabs,
    activeId: 'B',
    viewOrder: [
      { kind: 'note', id: 'C' },
      { kind: 'graph' },
      { kind: 'note', id: 'B' },
      { kind: 'note', id: 'A' },
    ],
    graphActive: true,
  });
  expect(workspace.graphActive).toBe(true);
  expect(workspace.tabs.map((tab) => tab.id)).toEqual(['C', 'B', 'A']);
  const order: ViewTab[] = [
    { kind: 'note', id: 'A' },
    { kind: 'note', id: 'C' },
    { kind: 'graph' },
    { kind: 'note', id: 'B' },
  ];
  await act(async () => workspace.reorderViews(order));
  expect(workspace.activeId).toBe('B');
  expect(workspace.graphActive).toBe(true);
  await act(async () => workspace.persistSession());
  expect(api.saveSession).toHaveBeenLastCalledWith(
    expect.objectContaining({
      viewOrder: order,
      graphActive: true,
      tabs: expect.arrayContaining(tabs),
    }),
  );
});
it('inserts beside the active graph and closes graph independently of note data', async () => {
  await mount({
    tabs,
    activeId: 'B',
    viewOrder: [
      { kind: 'note', id: 'A' },
      { kind: 'graph' },
      { kind: 'note', id: 'B' },
      { kind: 'note', id: 'C' },
    ],
    graphActive: true,
  });
  let id = '';
  await act(async () => {
    id = workspace.newDraft('draft', 'draft');
  });
  expect(workspace.viewOrder).toEqual([
    { kind: 'note', id: 'A' },
    { kind: 'graph' },
    { kind: 'note', id },
    { kind: 'note', id: 'B' },
    { kind: 'note', id: 'C' },
  ]);
  await act(async () => workspace.setGraphOpen(false));
  expect(workspace.tabs.find((tab) => tab.id === id)?.content).toBe('draft');
  expect(workspace.graphOpen).toBe(false);
  expect(workspace.graphActive).toBe(false);
});
it('drops stale and duplicate order entries while retaining every open note once', async () => {
  await mount({
    tabs,
    activeId: 'A',
    viewOrder: [
      { kind: 'note', id: 'missing' },
      { kind: 'note', id: 'C' },
      { kind: 'graph' },
      { kind: 'note', id: 'C' },
      { kind: 'graph' },
    ],
  });
  expect(workspace.viewOrder).toEqual([
    { kind: 'note', id: 'C' },
    { kind: 'graph' },
    { kind: 'note', id: 'A' },
    { kind: 'note', id: 'B' },
  ]);
  await act(async () => workspace.removeTab('C'));
  expect(workspace.viewOrder).toEqual([
    { kind: 'graph' },
    { kind: 'note', id: 'A' },
    { kind: 'note', id: 'B' },
  ]);
});
