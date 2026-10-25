// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
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
  vi.unstubAllGlobals();
});
it('resolves an imported draft image through its controlled origin callback', async () => {
  const resolve = vi.fn(async () => 'note-asset://generated/image.png');
  const fallback = vi.fn(async () => {
    throw Error('不得以草稿冒充已保存路径');
  });
  Reflect.set(window, 'notes', { assetUrl: fallback });
  await act(async () =>
    root.render(
      <MarkdownEditor
        value={'![导入图](relative.png)\n\n尾段'}
        initialCursor={30}
        mode="live"
        settings={defaultSettings}
        onChange={() => {}}
        resolveAssetAsync={resolve}
      />,
    ),
  );
  await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith('relative.png'));
  expect(fallback).not.toHaveBeenCalled();
  expect(host.querySelector('img')?.getAttribute('src')).toBe('note-asset://generated/image.png');
});
it('awaits file insertion through the existing pending-selection guard', async () => {
  const reference = createRef<MarkdownEditorHandle>();
  let finish!: (value: string) => void;
  const imported = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={reference}
        value="前ABC后"
        mode="source"
        settings={defaultSettings}
        onChange={() => {}}
        onImage={imported}
      />,
    ),
  );
  const view = reference.current!.getView()!;
  await act(async () => view.dispatch({ selection: { anchor: 1, head: 4 } }));
  let pending!: Promise<void>;
  await act(async () => {
    pending = reference.current!.insertFiles([
      new File(['bytes'], 'generated.png', { type: 'image/png' }),
    ]);
  });
  await act(async () =>
    view.dispatch({ changes: { from: 2, insert: '新输入' }, userEvent: 'input.type' }),
  );
  await act(async () => {
    finish('assets/generated.png');
    await pending;
  });
  expect(view.state.doc.toString()).toBe('前A新输入BC![generated.png](assets/generated.png)后');
});
