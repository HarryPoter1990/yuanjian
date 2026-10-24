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
it('offers absolute body and H1–H6 choices using the real editor with undo', async () => {
  await mount();
  const button = host.querySelector<HTMLButtonElement>('[aria-label="标题"]')!;
  expect(button.textContent).toContain('H1');
  await act(async () => button.click());
  const menu = host.querySelector<HTMLElement>('[role="menu"][aria-label="标题级别"]');
  expect(menu).not.toBeNull();
  expect(menu!.querySelectorAll('[role="menuitem"]')).toHaveLength(7);
  await act(async () =>
    [...menu!.querySelectorAll<HTMLButtonElement>('button')]
      .find((el) => el.textContent?.startsWith('H3'))!
      .click(),
  );
  expect(view().state.doc.line(1).text).toBe('### Alpha');
  await act(async () => expect(undo(view())).toBe(true));
  expect(view().state.doc.line(1).text).toBe('# Alpha');
  await act(async () => button.click());
  const current = host.querySelector<HTMLElement>('[role="menu"][aria-label="标题级别"]')!;
  expect(current.querySelector('[aria-current="true"]')?.textContent).toContain('H1');
  await act(async () =>
    [...current.querySelectorAll<HTMLButtonElement>('button')]
      .find((el) => el.textContent === '正文')!
      .click(),
  );
  expect(view().state.doc.line(1).text).toBe('Alpha');
});
