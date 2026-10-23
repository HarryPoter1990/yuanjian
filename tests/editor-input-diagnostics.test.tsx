// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import { defaultSettings } from '../src/shared/defaults';
import type { MarkdownEditorHandle } from '../src/editor/types';

let host: HTMLDivElement;
let root: Root;
let reference = createRef<MarkdownEditorHandle>();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('notes', { assetUrl: async () => '' });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  reference = createRef<MarkdownEditorHandle>();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(
  value: string,
  mode: 'live' | 'source' = 'live',
  anchor = value.length,
  head = anchor,
) {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={reference}
        value={value}
        initialCursor={anchor}
        onChange={onChange}
        settings={defaultSettings}
        mode={mode}
      />,
    ),
  );
  const view = reference.current?.getView();
  if (!view) throw new Error('Missing editor');
  if (anchor !== head) await act(async () => view.dispatch({ selection: { anchor, head } }));
  return { view, onChange };
}

function insertText(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  const defaultInsert = () =>
    view.state.update(view.state.replaceSelection(text), { userEvent: 'input.type' });
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, defaultInsert));
  if (!handled) view.dispatch(defaultInsert());
}

describe('input diagnostics', () => {
  describe.each(['live', 'source'] as const)('dollar input in %s mode', (mode) => {
    it.each([0, 1, 2, 3])('respects the parity of %i preceding backslashes', async (count) => {
      const source = `费用：${'\\'.repeat(count)}`;
      const { view } = await mount(source, mode);
      await act(async () => insertText(view, '$'));
      expect(view.state.doc.toString()).toBe(source + (count % 2 ? '$' : '$$'));
      expect(view.state.selection.main.head).toBe(source.length + 1);
    });

    it('skips an existing closing dollar only for an empty selection', async () => {
      const source = '$x$';
      const { view, onChange } = await mount(source, mode, 2);
      await act(async () => insertText(view, '$'));
      expect(view.state.doc.toString()).toBe(source);
      expect(view.state.selection.main.head).toBe(3);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('finishes a paired formula after two literal backslashes without inserting extra dollars', async () => {
      const prefix = '\\'.repeat(2);
      const { view } = await mount(prefix, mode);
      await act(async () => {
        insertText(view, '$');
        insertText(view, 'x');
        insertText(view, '$');
      });
      expect(view.state.doc.toString()).toBe(`${prefix}$x$`);
      expect(view.state.selection.main.head).toBe(prefix.length + 3);
    });

    it.each([
      { source: '替换正文', anchor: 0, head: 4, expected: '$', cursor: 1 },
      { source: '$abc$', anchor: 1, head: 4, expected: '$$$', cursor: 2 },
      { source: '$x$ 后文', anchor: 2, head: 6, expected: '$x$', cursor: 3 },
      { source: '$x$ 后文', anchor: 6, head: 2, expected: '$x$', cursor: 3 },
    ])(
      'replaces the selected range [$anchor,$head] in $source',
      async ({ source, anchor, head, expected, cursor }) => {
        const { view } = await mount(source, mode, anchor, head);
        await act(async () => insertText(view, '$'));
        expect(view.state.doc.toString()).toBe(expected);
        expect(view.state.selection.main.head).toBe(cursor);
        expect(view.state.selection.main.empty).toBe(true);
      },
    );

    it('does not skip an existing dollar when the newly typed dollar is escaped', async () => {
      const { view } = await mount('$x\\$', mode, 3);
      await act(async () => insertText(view, '$'));
      expect(view.state.doc.toString()).toBe('$x\\$$');
      expect(view.state.selection.main.head).toBe(4);
    });

    it('keeps dollar input literal inside fenced code', async () => {
      const source = '```js\nconst x = \n```';
      const offset = source.indexOf('\n```');
      const { view } = await mount(source, mode, offset);
      await act(async () => insertText(view, '$'));
      expect(view.state.doc.toString()).toBe(source.slice(0, offset) + '$' + source.slice(offset));
      expect(view.state.selection.main.head).toBe(offset + 1);
    });
  });

  it('uses the requested 1060ms full blink period for the drawn cursor', async () => {
    await mount('光标节奏');
    expect(host.querySelector<HTMLElement>('.cm-cursorLayer')?.style.animationDuration).toBe(
      '1060ms',
    );
  });

  it.each(['Enter', 'Escape'])(
    'leaves table candidate text and focus alone when %s is flagged as composing',
    async (key) => {
      const source = '| 名称 |\n| --- |\n| 旧值 |';
      const { view, onChange } = await mount(source);
      const cell = host.querySelector<HTMLInputElement>('[aria-label="表格第 2 行第 1 列"]');
      if (!cell) throw new Error('Missing table input');
      const event = new KeyboardEvent('keydown', {
        key,
        keyCode: 229,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      // This checks the isComposing branch only; synthetic events do not verify a Windows IME.
      await act(async () => {
        cell.focus();
        cell.value = '候选文字';
        cell.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const typed = source.replace('旧值', '候选文字');
      expect(view.state.doc.toString()).toBe(typed);
      const changesBeforeKey = onChange.mock.calls.length;
      await act(async () => cell.dispatchEvent(event));
      expect(view.state.doc.toString()).toBe(typed);
      expect(onChange).toHaveBeenCalledTimes(changesBeforeKey);
      expect(document.activeElement).toBe(cell);
      expect(cell.value).toBe('候选文字');
      expect(event.defaultPrevented).toBe(false);
    },
  );
});
