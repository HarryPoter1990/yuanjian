// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { loadGraphModule } from 'virtual:yuanjian-graph';
import App from '../src/App';
import { defaultSettings } from '../src/shared/defaults';
import { makeDraft } from '../src/ui/model';

vi.mock('virtual:yuanjian-graph', () => ({ loadGraphModule: vi.fn() }));
vi.mock('../src/components/GraphView', () => ({
  GraphView: () => <div data-testid="loaded-graph">图谱已加载</div>,
}));
vi.mock('../src/editor/MarkdownEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    MarkdownEditor: forwardRef(function Fixture(props: { value: string }, ref) {
      useImperativeHandle(ref, () => ({
        getHeadingLevel: () => 0,
        setHeading() {},
        getView: () => null,
        getCursor: () => 0,
        getScroll: () => 0,
        focus() {},
        command: () => true,
      }));
      return <div data-testid="draft-content">{props.value}</div>;
    }),
  };
});
it('opens graph code on demand, preserves the note through loading failure and retries before caching success', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
  const tab = { ...makeDraft('必须保留的笔记', '笔记'), id: 'generated' };
  Reflect.set(window, 'notes', {
    bootstrap: async () => ({
      settings: { ...structuredClone(defaultSettings), autoSave: false },
      session: { tabs: [tab], activeId: tab.id },
      fonts: [],
      dataDirectory: 'memory',
      version: 'test',
    }),
    saveSession: async () => {},
    saveSettings: async (value: typeof defaultSettings) => value,
    getIndex: async () => [],
    getTree: async () => [],
    getWindowMode: async () => ({ mode: 'full', pinned: false }),
    setWindowMode: async (mode: string) => ({ mode, pinned: false }),
    setWindowTheme: async () => {},
    onWindowModeChanged: () => () => {},
    onFilesChanged: () => () => {},
    onCloseRequested: () => () => {},
    onOpenRequested: () => () => {},
    onProgress: () => () => {},
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let reject!: (error: Error) => void;
  vi.mocked(loadGraphModule).mockImplementationOnce(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  try {
    await act(async () => root.render(<App />));
    expect(loadGraphModule).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="关系图谱"]')!.click(),
    );
    expect(loadGraphModule).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('正在打开图谱');
    await act(async () => reject(Error('generated chunk unavailable')));
    expect(host.textContent).toContain('图谱暂时未能打开');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(loadGraphModule).mockResolvedValueOnce({
      GraphView: () => <div data-testid="loaded-graph">图谱已加载</div>,
    });
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((x) => x.textContent === '重试加载')!
        .click(),
    );
    expect(loadGraphModule).toHaveBeenLastCalledWith(1);
    expect(host.querySelector('[data-testid="loaded-graph"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.tabs-bar [role="tab"]')!.click());
    expect(host.querySelector('[data-testid="draft-content"]')?.textContent).toBe('必须保留的笔记');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="关系图谱"]')!.click(),
    );
    expect(loadGraphModule).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="loaded-graph"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
