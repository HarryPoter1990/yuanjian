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
const first = {
  ...makeDraft(
    '# Alpha\n\n原文A\n\n' + Array.from({ length: 80 }, (_, i) => `A 段落 ${i}`).join('\n\n'),
    'Alpha',
  ),
  id: 'A',
  cursor: 0,
};
const second = {
  ...makeDraft(
    '# Beta\n\n原文B\n\n' + Array.from({ length: 80 }, (_, i) => `B 段落 ${i}`).join('\n\n'),
    'Beta',
  ),
  id: 'B',
  cursor: 0,
};
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
async function alt(direction: 'Left' | 'Right') {
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: `Arrow${direction}`,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
it('navigates back and forward through note positions without recording ordinary editing', async () => {
  await mount();
  await act(async () => view().dispatch({ selection: { anchor: 4 } }));
  view().scrollDOM.scrollTop = 80;
  await clickNote('Beta');
  await act(async () =>
    view().dispatch({
      changes: { from: view().state.doc.length, insert: ' 输入' },
      selection: { anchor: 6 },
    }),
  );
  view().scrollDOM.scrollTop = 140;
  await alt('Left');
  expect(view().state.doc.toString()).toBe(first.content);
  expect(view().state.selection.main.head).toBe(4);
  expect(view().scrollDOM.scrollTop).toBe(80);
  await alt('Right');
  expect(view().state.doc.toString()).toBe(second.content + ' 输入');
  expect(view().state.selection.main.head).toBe(6);
  expect(view().scrollDOM.scrollTop).toBe(140);
});
it('clears the forward branch when a different note is chosen explicitly', async () => {
  const third = { ...makeDraft('Gamma content', 'Gamma'), id: 'C' };
  await mount({ tabs: [first, second, third], activeId: 'A' });
  await clickNote('Beta');
  await clickNote('Gamma');
  await alt('Left');
  expect(view().state.doc.toString()).toBe(second.content);
  await clickNote('Alpha');
  await alt('Right');
  expect(view().state.doc.toString()).toBe(first.content);
});
it('records an outline jump within the same note and restores its exact former position', async () => {
  const note = {
    ...first,
    content: '# Top\n\nfirst paragraph\n\n## Target\n\nlast paragraph',
    cursor: 0,
  };
  await mount({ tabs: [note], activeId: note.id });
  await act(async () => view().dispatch({ selection: { anchor: 5 } }));
  const target = [...host.querySelectorAll<HTMLButtonElement>('#right-outline button')].find(
    (el) => el.textContent === 'Target',
  )!;
  await act(async () => target.click());
  const destination = note.content.indexOf('## Target');
  expect(view().state.selection.main.head).toBe(destination);
  await alt('Left');
  expect(view().state.selection.main.head).toBe(5);
  await alt('Right');
  expect(view().state.selection.main.head).toBe(destination);
});
it('can reopen a closed named navigation target', async () => {
  const named = { ...first, path: 'D:/generated/Alpha.md', dirty: false };
  const read = vi.fn(async () => named);
  await mount(
    { tabs: [named, second], activeId: 'A' },
    { openFile: read, centerWindow: async () => {} },
  );
  await clickNote('Beta');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="关闭 Alpha"]')!.click(),
  );
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  await alt('Left');
  expect(view().state.doc.toString()).toBe(named.content);
  expect(read).toHaveBeenCalledTimes(2);
});
it('removes discarded anonymous navigation locations instead of reviving them', async () => {
  await mount();
  await clickNote('Beta');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="关闭 Alpha"]')!.click(),
  );
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((el) => el.textContent === '丢弃修改并关闭')!
      .click(),
  );
  await alt('Left');
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  expect(view().state.doc.toString()).toBe(second.content);
});
it('keeps the current note and failed history target until an explicit retry succeeds', async () => {
  const named = { ...first, path: 'D:/generated/Alpha.md', dirty: false };
  let fail = false;
  const read = vi.fn(async () => {
    if (fail) throw Error('generated navigation read failure');
    return named;
  });
  await mount(
    { tabs: [named, second], activeId: 'A' },
    { openFile: read, centerWindow: async () => {} },
  );
  await clickNote('Beta');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="关闭 Alpha"]')!.click(),
  );
  fail = true;
  await alt('Left');
  expect(view().state.doc.toString()).toBe(second.content);
  expect(host.textContent).toContain('generated navigation read failure');
  fail = false;
  await alt('Left');
  expect(view().state.doc.toString()).toBe(named.content);
  expect(read).toHaveBeenCalledTimes(3);
});
it('ignores a delayed closed-file history read after the user chooses another tab', async () => {
  const named = { ...first, path: 'D:/generated/Alpha.md', dirty: false };
  let delay = false;
  let resolve: ((note: typeof named) => void) | null = null;
  const read = vi.fn(async () =>
    delay
      ? new Promise<typeof named>((yes) => {
          resolve = yes;
        })
      : named,
  );
  await mount(
    { tabs: [named, second], activeId: 'A' },
    { openFile: read, centerWindow: async () => {} },
  );
  await clickNote('Beta');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="关闭 Alpha"]')!.click(),
  );
  delay = true;
  await alt('Left');
  expect(resolve).not.toBeNull();
  await clickNote('Beta');
  await act(async () => {
    resolve!(named);
  });
  expect(view().state.doc.toString()).toBe(second.content);
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
});
it('keeps a draft navigation location reopenable after that draft is saved while closing', async () => {
  const named = { ...first, path: 'D:/generated/Alpha.md', dirty: false };
  const read = vi.fn(async () => named);
  await mount(undefined, {
    openFile: read,
    centerWindow: async () => {},
    saveFile: async () => ({ status: 'saved', note: named }),
  });
  await clickNote('Beta');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="关闭 Alpha"]')!.click(),
  );
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((el) => el.textContent === '保存并关闭')!
      .click(),
  );
  expect(host.querySelector('#document-tab-note-A')).toBeNull();
  await alt('Left');
  expect(view().state.doc.toString()).toBe(named.content);
  expect(read).toHaveBeenCalledTimes(1);
});
