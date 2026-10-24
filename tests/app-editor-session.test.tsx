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
  vi.unstubAllGlobals();
});
async function mount(session: SessionState = { tabs: [first, second], activeId: first.id }) {
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
it.each(['note', 'graph'])(
  'keeps the real editor undo history when returning from another %s view',
  async (mode) => {
    await mount();
    await act(async () =>
      view().dispatch({ changes: { from: view().state.doc.length, insert: ' 新输入' } }),
    );
    if (mode === 'note') await clickNote('Beta');
    else await graph();
    await clickNote('Alpha');
    await act(async () => {
      expect(undo(view())).toBe(true);
    });
    expect(view().state.doc.toString()).toBe(first.content);
  },
);
it('performs find after the graph has returned to its mounted editor', async () => {
  await mount();
  await graph();
  expect(host.querySelector('[data-testid="graph-view"]')).not.toBeNull();
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(host.querySelector('.cm-content')).not.toBeNull();
  expect(host.querySelector('.cm-search')).not.toBeNull();
});
it('renders saved mixed note and graph order in the actual tab list', async () => {
  await mount({
    tabs: [first, second],
    activeId: 'B',
    viewOrder: [{ kind: 'note', id: 'B' }, { kind: 'graph' }, { kind: 'note', id: 'A' }],
  });
  expect(
    [...host.querySelectorAll('.tabs-bar [role="tab"]')].map((tab) => tab.textContent),
  ).toEqual(['Beta', '关系图谱', 'Alpha']);
});

it('cycles through the same mixed visual order with Ctrl+Tab in both directions', async () => {
  await mount({
    tabs: [first, second],
    activeId: 'B',
    viewOrder: [{ kind: 'note', id: 'B' }, { kind: 'graph' }, { kind: 'note', id: 'A' }],
  });
  const key = async (shiftKey = false) =>
    act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          ctrlKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  await key();
  expect(host.querySelector('[data-testid="graph-view"]')).not.toBeNull();
  await key();
  expect(view().state.doc.toString()).toBe(first.content);
  await key(true);
  expect(host.querySelector('[data-testid="graph-view"]')).not.toBeNull();
});
