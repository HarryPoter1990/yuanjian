// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { defaultSettings } from '../src/shared/defaults';
import { makeDraft } from '../src/ui/model';

let host: HTMLDivElement, root: Root;
let externalOpen: (path: string) => void = () => {};
const a = {
  ...makeDraft('# A\n\n零一二三四五六七八九', 'A'),
  id: 'A',
  path: 'D:/generated/A.md',
  dirty: false,
  cursor: 2,
  scrollTop: 25,
};
const b = {
  ...makeDraft('B source body', 'B'),
  id: 'B',
  path: 'D:/generated/B.md',
  dirty: false,
  cursor: 4,
  scrollTop: 42,
  mode: 'source' as const,
};
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
  overrides: Record<string, unknown> = {},
  session: Record<string, unknown> = { tabs: [a, b], activeId: 'A' },
) {
  Reflect.set(window, 'notes', {
    bootstrap: async () => ({
      settings: { ...structuredClone(defaultSettings), autoSave: false },
      session: structuredClone(session),
      fonts: [],
      dataDirectory: 'in-memory',
      version: 'cross-review',
    }),
    openFile: async (path: string) => ({ ...[a, b].find((note) => note.path === path)! }),
    getIndex: async () => [],
    getTree: async () => [],
    saveSession: async () => {},
    saveSettings: async (value: unknown) => value,
    getWindowMode: async () => ({ mode: 'full', pinned: false }),
    setWindowMode: async (mode: string) => ({ mode, pinned: false }),
    setWindowTheme: async () => {},
    centerWindow: async () => {},
    onWindowModeChanged: () => () => {},
    onFilesChanged: () => () => {},
    onCloseRequested: () => () => {},
    onOpenRequested: (handler: (path: string) => void) => {
      externalOpen = handler;
      return () => {};
    },
    onProgress: () => () => {},
    ...overrides,
  });
  await act(async () => root.render(<App />));
}
const view = () => EditorView.findFromDOM(host.querySelector('.cm-content')!)!;
async function key(key: string, shiftKey = false) {
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
async function click(selector: string) {
  await act(async () => host.querySelector<HTMLElement>(selector)!.click());
}
async function textButton(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function select(id: string) {
  await click(`#document-tab-note-${id}`);
}
async function graph() {
  await click('[aria-label="关系图谱"]');
}
async function query(text: string) {
  const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function enter(input: HTMLInputElement) {
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    ),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function alt() {
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
async function pendingBack() {
  const pending = deferred<typeof a>();
  let armed = false;
  const c = { ...a, id: 'C', title: 'C', path: 'D:/generated/C.md', content: 'C keep open' };
  await mount(
    {
      openFile: async (path: string) =>
        armed && path === a.path
          ? pending.promise
          : { ...[a, b, c].find((note) => note.path === path)! },
      centerWindow: async () => {},
    },
    { tabs: [a, b, c], activeId: 'A' },
  );
  await select('B');
  await click('[aria-label="关闭 A"]');
  armed = true;
  await alt();
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  expect(view().state.doc.toString()).toBe(b.content);
  return pending;
}
it.each(['f', 'h'])(
  'a newer Ctrl%s search command cancels an older pending back read',
  async (command) => {
    const pending = await pendingBack();
    await key(command);
    expect(host.querySelector('.cm-search')).not.toBeNull();
    await act(async () => pending.resolve(a));
    expect(view().state.doc.toString()).toBe(b.content);
    expect(host.querySelector('.cm-search')).not.toBeNull();
    expect(host.querySelector('#document-tab-note-A')).toBeNull();
  },
);
it('external-open request for the already-current file cancels older pending navigation', async () => {
  const pending = await pendingBack();
  await act(async () => externalOpen(b.path!));
  expect(view().state.doc.toString()).toBe(b.content);
  await act(async () => pending.resolve(a));
  expect(view().state.doc.toString()).toBe(b.content);
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
});
it('new draft cancels pending closed-file navigation', async () => {
  const pending = await pendingBack();
  await key('n');
  const selected = host.querySelector('[role="tab"][aria-selected="true"]')?.id;
  expect(view().state.doc.toString()).toBe('');
  await act(async () => pending.resolve(a));
  expect(view().state.doc.toString()).toBe('');
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe(selected);
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
});
it('clean active close cancels pending navigation and retains remaining note', async () => {
  const pending = await pendingBack();
  await click('[aria-label="关闭 B"]');
  const selected = host.querySelector('[role="tab"][aria-selected="true"]')?.id;
  await act(async () => pending.resolve(a));
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe(selected);
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  expect(view().state.doc.toString()).toBe('C keep open');
});
it('explicitly choosing current tab cancels pending navigation', async () => {
  const pending = await pendingBack();
  await select('B');
  await act(async () => pending.resolve(a));
  expect(view().state.doc.toString()).toBe(b.content);
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
});
