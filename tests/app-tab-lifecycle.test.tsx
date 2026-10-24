// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { defaultSettings } from '../src/shared/defaults';
import { makeDraft } from '../src/ui/model';
import type { SessionState } from '../src/shared/types';

vi.mock('../src/components/GraphView', () => ({
  GraphView: () => <div data-testid="graph-view">图谱夹具</div>,
}));
vi.mock('virtual:yuanjian-graph', () => ({
  loadGraphModule: () => import('../src/components/GraphView'),
}));
let host: HTMLDivElement, root: Root;
const first = { ...makeDraft('# Alpha\n\n原文A', 'Alpha'), id: 'A', cursor: 0 };
const second = { ...makeDraft('# Beta\n\n原文B', 'Beta'), id: 'B', cursor: 0 };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no layout; model a scrollable long-document viewport for measured restoration.
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('cm-scroller') ? 10000 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('cm-scroller') ? 600 : 0;
  });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  window.matchMedia = (media) => ({
    matches: false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(
  session: SessionState = { tabs: [first, second], activeId: first.id },
  overrides: Record<string, unknown> = {},
) {
  Reflect.set(window, 'notes', {
    bootstrap: async () => ({
      settings: { ...structuredClone(defaultSettings), autoSave: false },
      session: structuredClone(session),
      fonts: [],
      dataDirectory: 'in-memory',
      version: 'test',
    }),
    getIndex: async () => [],
    getTree: async () => [],
    saveSession: async () => {},
    saveSettings: async (value: typeof defaultSettings) => value,
    getWindowMode: async () => ({ mode: 'full', pinned: false }),
    setWindowMode: async (mode: string) => ({ mode, pinned: false }),
    setWindowTheme: async () => {},
    onWindowModeChanged: () => () => {},
    onFilesChanged: () => () => {},
    onCloseRequested: () => () => {},
    onOpenRequested: () => () => {},
    onProgress: () => () => {},
    ...overrides,
  });
  await act(async () => root.render(<App />));
}
const view = () => EditorView.findFromDOM(host.querySelector('.cm-content')!)!;
async function clickNote(title: string) {
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]')]
      .find((tab) => tab.textContent?.includes(title))!
      .click(),
  );
}
async function graph() {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关系图谱"]')!.click());
}
async function shortcut(key: string, shiftKey = false) {
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
async function clickText(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
const named = {
  ...first,
  content: first.content + '\n\n' + Array.from({ length: 80 }, (_, i) => `段落 ${i}`).join('\n\n'),
  path: 'D:/generated/Alpha.md',
  dirty: false,
};
it('reopens a closed saved note at its last position with a fresh undo history', async () => {
  let disk = { ...named };
  const centerWindow = vi.fn(async () => {});
  await mount(
    { tabs: [named, second], activeId: named.id },
    {
      centerWindow,
      openFile: async () => disk,
      saveFile: async (request: { content: string }) => {
        disk = { ...disk, content: request.content, hash: 'saved' };
        return { status: 'saved', note: disk };
      },
    },
  );
  await act(async () =>
    view().dispatch({
      changes: { from: view().state.doc.length, insert: ' 新内容' },
      selection: { anchor: 3 },
    }),
  );
  view().scrollDOM.scrollTop = 120;
  await shortcut('s');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="关闭 Alpha"]')!.click(),
  );
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  await shortcut('t', true);
  expect(view().state.doc.toString()).toBe(disk.content);
  expect(view().state.selection.main.head).toBe(3);
  expect(view().scrollDOM.scrollTop).toBe(120);
  await act(async () => expect(undo(view())).toBe(false));
});
it('does not revive an explicitly discarded anonymous draft', async () => {
  await mount();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="关闭 Alpha"]')!.click(),
  );
  await clickText('丢弃修改并关闭');
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  await shortcut('t', true);
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  expect(host.querySelectorAll('.tabs-bar [role="tab"]')).toHaveLength(1);
});
async function context(id: string) {
  await act(async () =>
    host.querySelector<HTMLElement>(`[data-view-key="note:${id}"]`)!.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 400,
        clientY: 30,
        cancelable: true,
      }),
    ),
  );
}
it('stops batch close at cancellation and can reopen the already closed saved note', async () => {
  const third = { ...makeDraft('C unsaved', 'Gamma'), id: 'C' };
  await mount(
    { tabs: [named, second, third], activeId: named.id },
    { openFile: async () => named, centerWindow: async () => {} },
  );
  await context('B');
  await clickText('关闭其他标签');
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  expect(host.querySelector('#document-tab-note-C')).not.toBeNull();
  await clickText('继续编辑');
  expect(host.querySelector('#document-tab-note-C')).not.toBeNull();
  await shortcut('t', true);
  expect(host.querySelector('#document-tab-note-A')).not.toBeNull();
});
it('stops remaining batch closes after a save failure', async () => {
  const third = { ...makeDraft('C unsaved', 'Gamma'), id: 'C' };
  await mount(
    { tabs: [named, second, third], activeId: named.id },
    {
      openFile: async () => named,
      saveFile: async () => {
        throw Error('generated disk full');
      },
    },
  );
  await context('A');
  await clickText('关闭右侧标签');
  await clickText('保存并关闭');
  expect(host.querySelectorAll('.tabs-bar [role="tab"]')).toHaveLength(3);
  expect(host.querySelector('dialog')).toBeNull();
  expect(host.textContent).toContain('generated disk full');
});
