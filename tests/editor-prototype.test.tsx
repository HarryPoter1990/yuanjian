// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
let host: HTMLDivElement, root: Root;
let ref = createRef<MarkdownEditorHandle>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0,0,1,20) });
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host); ref = createRef<MarkdownEditorHandle>();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(source: string, selected = false) {
  await act(async () => root.render(<MarkdownEditor prototypeEditing ref={ref} value={source} mode="source" settings={defaultSettings} onChange={() => {}} />));
  const view = ref.current!.getView()!;
  await act(async () => { view.dispatch({ selection: { anchor: selected ? 0 : source.length, head: source.length } }); view.focus(); });
  return view;
}
async function key(key: string, shiftKey = false) {
  await act(async () => { ref.current!.getView()!.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })); });
}
it.each(['heading','list','task'] as const)('keeps block math intact during %s formatting', async name => {
  const view = await mount('开头\n\n$$\nx^2\n$$\n\n结尾', true);
  await act(async () => { ref.current!.command(name); });
  expect(view.state.doc.toString()).toContain('\n$$\nx^2\n$$\n');
});
it('indents an ordered list under the preceding item and restores it', async () => {
  const source = '1. 第一项\n2. 第二项'; const view = await mount(source);
  await key('Tab'); expect(view.state.doc.toString()).toBe('1. 第一项\n   2. 第二项');
  await key('Tab', true); expect(view.state.doc.toString()).toBe(source);
});
it('exits an empty nested quote one level at a time', async () => {
  const view = await mount('> > '); await key('Enter'); expect(view.state.doc.toString()).toBe('> ');
  await key('Enter'); expect(view.state.doc.toString()).toBe('');
});
it('deletes an empty dollar pair in one step', async () => {
  const view = await mount('$$'); await act(async () => view.dispatch({ selection: { anchor: 1 } }));
  await key('Backspace'); expect(view.state.doc.toString()).toBe('');
});
it.each(['```js','$$'])('completes an opening block %s on Enter', async source => {
  const view = await mount(source); await key('Enter');
  expect(view.state.doc.toString()).toBe(source + '\n\n' + (source.startsWith('`') ? '```' : '$$'));
  expect(view.state.selection.main.head).toBe(source.length + 1);
});
it.each(['code','math','link'] as const)('undoes typing separately from %s wrapping', async name => {
  const view = await mount('abc', true);
  await act(async () => { ref.current!.command(name); });
  const wrapped = view.state.doc.toString();
  await act(async () => view.dispatch(view.state.replaceSelection('x'), { userEvent: 'input.type' }));
  await act(async () => { ref.current!.command('undo'); });
  expect(view.state.doc.toString()).toBe(wrapped);
});
