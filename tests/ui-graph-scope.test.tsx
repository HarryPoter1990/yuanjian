// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GraphView } from '../src/components/GraphView';
import { defaultSettings } from '../src/shared/defaults';
import type { NoteMeta } from '../src/shared/types';
import cytoscape, { type CytoscapeOptions } from 'cytoscape';

vi.mock('cytoscape', async () => {
  const actual = await vi.importActual<{ default: typeof import('cytoscape') }>('cytoscape');
  return {
    default: (options: CytoscapeOptions) =>
      actual.default({ ...options, container: undefined, headless: true, styleEnabled: false }),
  };
});
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.matchMedia = () => ({ matches: false }) as MediaQueryList;
  Reflect.set(window, 'notes', { onCloseRequested: () => () => {}, resolveLink: vi.fn() });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it.each(['D:/generated/notes', 'd:/GENERATED/NOTES/', 'D:\\generated\\notes\\'])(
  'filters graph nodes by the directory boundary, accepting Windows path spelling %s',
  async (scope) => {
    const settings = structuredClone(defaultSettings);
    settings.graph.root = scope;
    settings.graph.local = false;
    settings.graph.tags = false;
    const index: NoteMeta[] = [
      'D:/generated/notes/inside.md',
      'D:/generated/notes/sub/nested.md',
      'D:/generated/notes-archive/outside.md',
    ].map((path) => ({ path, title: path, tags: [], headings: [], links: [], modifiedAt: 1 }));
    await act(async () =>
      root.render(
        <GraphView
          engine={cytoscape}
          index={index}
          settings={settings}
          activePath={null}
          onSettings={() => {}}
          onOpen={() => {}}
          onError={(error) => {
            throw Error(error);
          }}
        />,
      ),
    );
    expect(host.querySelector('.graph-legend')?.textContent).toContain('2 个节点');
    expect(host.querySelector('.graph-message')).toBeNull();
  },
);
