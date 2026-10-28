// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import { defaultSettings } from '../src/shared/defaults';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { renderMarkdown } from '../src/editor/renderer';

it('uses the approved keyboard behavior without a prototype prop', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    ref = createRef<MarkdownEditorHandle>();
  try {
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value="> > "
          initialCursor={4}
          mode="source"
          settings={defaultSettings}
          onChange={() => {}}
        />,
      ),
    );
    await act(async () =>
      ref
        .current!.getView()!
        .contentDOM.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        ),
    );
    expect(ref.current!.getView()!.state.doc.toString()).toBe('> ');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
it('uses common note syntax in the default rendering path', () => {
  expect(renderMarkdown('==重点==')).toContain('<mark>重点</mark>');
});
