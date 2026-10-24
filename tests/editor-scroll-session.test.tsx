// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { EditorSession, MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
let host: HTMLDivElement, root: Root;
let ref = createRef<MarkdownEditorHandle>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  ref = createRef<MarkdownEditorHandle>();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(capture?: (value: EditorSession) => void) {
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={'长文\n'.repeat(50)}
        mode="source"
        settings={defaultSettings}
        onChange={() => {}}
        onSessionSave={capture}
      />,
    ),
  );
  return ref.current!.getView()!;
}
describe('tab scroll snapshots and measured restoration', () => {
  it('captures scroll before React removes the scroller rather than after it resets', async () => {
    let session: EditorSession | undefined;
    const view = await mount((value) => {
      session = value;
    });
    Object.defineProperty(view.scrollDOM, 'scrollTop', {
      configurable: true,
      get() {
        return this.isConnected ? 240 : 0;
      },
      set() {},
    });
    await act(async () => root.render(null));
    expect(session?.scrollTop).toBe(240);
    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
  });
  it('keeps the last scroll event when an ancestor layout change clamps DOM before cleanup', async () => {
    let session: EditorSession | undefined;
    const view = await mount((value) => {
      session = value;
    });
    view.scrollDOM.scrollTop = 240;
    view.scrollDOM.dispatchEvent(new Event('scroll'));
    // Removing a sibling toolbar may clamp the still-connected scroller first.
    view.scrollDOM.scrollTop = 218;
    await act(async () => root.render(null));
    expect(session?.scrollTop).toBe(240);
  });
  it('exposes only JSON numbers from the public scrollSnapshot contract', async () => {
    const view = await mount();
    view.scrollDOM.scrollTop = 123;
    view.scrollDOM.scrollLeft = 4;
    const actual = view.scrollSnapshot().value;
    expect(ref.current!.getScrollAnchor()).toEqual({
      from: actual.range.head,
      offset: actual.yMargin,
      left: actual.xMargin,
    });
  });
  it('lets the latest restoration request own selection and intended pixel position', async () => {
    const view = await mount();
    await act(async () => {
      ref.current!.restorePosition(3, 200);
      ref.current!.restorePosition(8, 350);
    });
    expect(view.state.selection.main.head).toBe(8);
    expect(ref.current!.getScroll()).toBe(350);
    expect(view.hasFocus).toBe(true);
  });
  it('restores an existing view to the top rather than treating zero as no request', async () => {
    const view = await mount();
    view.scrollDOM.scrollTop = 150;
    await act(async () => ref.current!.restorePosition(0, 0));
    expect(view.scrollDOM.scrollTop).toBe(0);
  });
  it('lets user scrolling and an explicit line jump cancel an unfinished restore', async () => {
    const view = await mount();
    await act(async () => ref.current!.restorePosition(0, 200));
    view.scrollDOM.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 20 }));
    view.scrollDOM.scrollTop = 80;
    expect(ref.current!.getScroll()).toBe(80);
    await act(async () => ref.current!.restorePosition(0, 300));
    await act(async () => ref.current!.scrollToLine(20));
    view.scrollDOM.scrollTop = 90;
    expect(ref.current!.getScroll()).toBe(90);
  });
});
