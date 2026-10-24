// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import { renderMarkdown } from '../src/editor/renderer';
import { previewSourcePosition } from '../src/editor/preview-source-position';

let host: HTMLDivElement, root: Root;
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(document, 'caretPositionFromPoint');
  vi.unstubAllGlobals();
});
async function mount(source: string) {
  const ref = createRef<MarkdownEditorHandle>();
  const onLink = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={source}
        mode="live"
        settings={defaultSettings}
        initialCursor={source.length}
        onChange={() => {}}
        onLink={onLink}
      />,
    ),
  );
  return { view: ref.current!.getView()!, onLink };
}
describe('precise source positions around generated inline content', () => {
  it.each([
    '前 $x$ 后 **目标**',
    '前 [[目标|别名]] 后 **目标**',
    '> 前 $x$ 后 **目标**',
    '- 前 $x$ 后 **目标**',
  ])('maps ordinary repeated text after generated content: %s', (source) => {
    const element = document.createElement('div');
    element.innerHTML = renderMarkdown(source);
    expect(
      previewSourcePosition(element, source, element.querySelector('strong')!.firstChild, 1),
    ).toBe(source.indexOf('**目标**') + 3);
  });
  it('maps a wiki alias to its exact label source rather than its target', () => {
    const source = '前 [[目标|别名]] 后';
    const element = document.createElement('div');
    element.innerHTML = renderMarkdown(source);
    expect(previewSourcePosition(element, source, element.querySelector('a')!.firstChild, 1)).toBe(
      source.indexOf('别名') + 1,
    );
  });
  it.each(['前 $x$ 后 $y$ 后', '$$\nx+1\n$$', '前 $\\badcommand$ 后'])(
    'routes each formula node to its own raw source: %s',
    (source) => {
      const element = document.createElement('div');
      element.innerHTML = renderMarkdown(source);
      const formulas = [...element.querySelectorAll('.katex,.katex-error')];
      const first = source.indexOf('$');
      expect(previewSourcePosition(element, source, formulas[0], 0)).toBe(
        first + (source.startsWith('$$') ? 2 : 1),
      );
      if (formulas.length === 2)
        expect(previewSourcePosition(element, source, formulas[1], 0)).toBe(
          source.indexOf('$y$') + 1,
        );
    },
  );
  it('activates only the clicked mixed block at the exact ordinary character', async () => {
    const source = '# 顶\n\n前 $x$ 后 **目标**\n\n尾段';
    const { view } = await mount(source);
    const strong = host.querySelector('strong')!;
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: strong.firstChild, offset: 1 }),
    });
    await act(async () =>
      strong.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true })),
    );
    expect(view.state.selection.main.head).toBe(source.indexOf('目标') + 1);
    expect(host.querySelector('h1')?.textContent).toBe('顶');
    expect(view.state.doc.toString()).toBe(source);
  });
  it('activates a clicked formula even when DOM caret hit-testing cannot enter generated math', async () => {
    const source = '# 顶\n\n前 $x$ 后\n\n尾段';
    const { view } = await mount(source);
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => null,
    });
    await act(async () =>
      host
        .querySelector('.katex')!
        .dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true })),
    );
    expect(view.state.selection.main.head).toBe(source.indexOf('$x$') + 1);
    expect(view.state.doc.toString()).toBe(source);
  });
  it('edits a live link on ordinary pointer click and opens it with Ctrl or keyboard activation', async () => {
    const source = '# 顶\n\n[显示](target.md)\n\n尾段';
    const { view, onLink } = await mount(source);
    const link = host.querySelector('a')!;
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: link.firstChild, offset: 1 }),
    });
    await act(async () =>
      link.dispatchEvent(
        new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true, ctrlKey: true }),
      ),
    );
    expect(onLink).toHaveBeenCalledWith('target.md');
    onLink.mockClear();
    await act(async () =>
      link.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true, cancelable: true })),
    );
    expect(onLink).toHaveBeenCalledWith('target.md');
    onLink.mockClear();
    await act(async () =>
      link.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true })),
    );
    expect(onLink).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(source.indexOf('显示') + 1);
    expect(view.state.doc.toString()).toBe(source);
  });
});
