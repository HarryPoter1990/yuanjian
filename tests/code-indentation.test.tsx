// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { languages } from '@codemirror/language-data';
import { LanguageDescription } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { codeIndentation } from '../src/editor/code-indentation';
import {
  autocompletion,
  selectedCompletion,
  snippet,
  startCompletion,
} from '@codemirror/autocomplete';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import type { Settings } from '../src/shared/types';
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
async function mount(
  marked: string,
  settings: Partial<Settings> = {},
  mode: 'live' | 'source' = 'source',
  language?: string,
) {
  if (language) await LanguageDescription.matchLanguageName(languages, language)!.load();
  const cursor = marked.indexOf('¦');
  const source = marked.replace('¦', '');
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={source}
        initialCursor={cursor}
        mode={mode}
        settings={{ ...defaultSettings, ...settings }}
        onChange={() => {}}
      />,
    ),
  );
  const view = ref.current!.getView()!;
  await act(async () => {
    view.focus();
  });
  if (language)
    await vi.waitFor(() =>
      expect(markdownLanguage.isActiveAt(view.state, view.state.selection.main.head)).toBe(false),
    );
  return view;
}
async function key(key: string, shiftKey = false) {
  await act(async () =>
    ref
      .current!.getView()!
      .contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
      ),
  );
}
function marked() {
  const state = ref.current!.getView()!.state;
  const from = state.selection.main.head;
  return state.sliceDoc(0, from) + '¦' + state.sliceDoc(from);
}
it.each(['live', 'source'] as const)(
  'uses four-space JavaScript indentation and expands empty braces in %s',
  async (mode) => {
    await mount('```javascript\nif (ready) {¦}\n```', {}, mode, 'javascript');
    await key('Enter');
    expect(marked()).toBe('```javascript\nif (ready) {\n    ¦\n}\n```');
    ref.current!.command('undo');
    expect(marked()).toBe('```javascript\nif (ready) {¦}\n```');
  },
);
it.each([2, 4, 8] as const)('uses the configured %i columns for Python Enter', async (size) => {
  await mount('```python\nif ready:¦\n```', { codeIndentSize: size }, 'source', 'python');
  await key('Enter');
  expect(marked()).toBe(`\`\`\`python\nif ready:\n${' '.repeat(size)}¦\n\`\`\``);
});
it('uses real tabs with the configured display width', async () => {
  const view = await mount(
    '```javascript\nif (ready) {¦}\n```',
    { codeIndentSize: 8, codeIndentStyle: 'tabs' },
    'source',
    'javascript',
  );
  await key('Enter');
  expect(marked()).toBe('```javascript\nif (ready) {\n\t¦\n}\n```');
  expect(view.state.tabSize).toBe(8);
});
it('does not infer bracket indentation for an unknown language', async () => {
  await mount('```unknown\n    {¦}\n```');
  await key('Enter');
  expect(marked()).toBe('```unknown\n    {\n    ¦}\n```');
});
it('can disable automatic code indentation without affecting the existing line', async () => {
  await mount('```python\n    if ready:¦\n```', { codeAutoIndent: false }, 'source', 'python');
  await key('Enter');
  expect(marked()).toBe('```python\n    if ready:\n¦\n```');
});
it.each(['"{¦}"', '// {¦}'])('does not expand braces inside %s', async (text) => {
  await mount(`\`\`\`javascript\n${text}\n\`\`\``, {}, 'source', 'javascript');
  await key('Enter');
  expect(ref.current!.getView()!.state.doc.lines).toBe(4);
});
it('inserts to the next tab stop and removes leading whitespace by level', async () => {
  await mount('```text\n  ¦value\n```');
  await key('Tab');
  expect(marked()).toBe('```text\n    ¦value\n```');
  await key('Backspace');
  expect(marked()).toBe('```text\n¦value\n```');
  await key('Tab');
  await key('Tab');
  await key('Tab', true);
  expect(marked()).toBe('```text\n    ¦value\n```');
});
it('indents selected code lines as one undoable operation and retains the selection', async () => {
  const view = await mount('```text\n¦first\nsecond\n```');
  await act(async () => view.dispatch({ selection: { anchor: 8, head: 20 } }));
  await key('Tab');
  expect(view.state.doc.toString()).toBe('```text\n    first\n    second\n```');
  expect(view.state.selection.main.empty).toBe(false);
  await key('Tab', true);
  expect(view.state.doc.toString()).toBe('```text\nfirst\nsecond\n```');
  ref.current!.command('undo');
  expect(view.state.doc.toString()).toBe('```text\n    first\n    second\n```');
});
it('changes settings without rewriting existing mixed whitespace or losing undo', async () => {
  const source = '```text\n\t  original¦\n```';
  const view = await mount(source);
  await act(async () =>
    view.dispatch({ changes: { from: view.state.selection.main.head, insert: '!' } }),
  );
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={view.state.doc.toString()}
        mode="source"
        settings={{ ...defaultSettings, codeIndentSize: 8, codeIndentStyle: 'tabs' }}
        onChange={() => {}}
      />,
    ),
  );
  expect(view.state.doc.toString()).toBe(source.replace('¦', '!'));
  expect(view.state.tabSize).toBe(8);
  ref.current!.command('undo');
  expect(view.state.doc.toString()).toBe(source.replace('¦', ''));
});
it.each([2, 4, 8] as const)('preserves ordinary list nesting at code width %i', async (size) => {
  await mount('1. 父项\n2. 子项¦', { codeIndentSize: size, codeIndentStyle: 'tabs' });
  await key('Tab');
  expect(ref.current!.getView()!.state.doc.toString()).toBe('1. 父项\n   2. 子项');
  await key('Tab', true);
  expect(ref.current!.getView()!.state.doc.toString()).toBe('1. 父项\n2. 子项');
});
it('keeps the surrounding quote while continuing code inside a quoted fence', async () => {
  await mount('> ```javascript\n> if (ready) {¦}\n> ```', {}, 'source', 'javascript');
  await key('Enter');
  expect(marked()).toBe('> ```javascript\n> if (ready) {\n>     ¦\n> }\n> ```');
});
it('does not remove the containing list indentation when unindenting code', async () => {
  await mount('- 学习\n\n    ```text\n    ¦record();\n    ```');
  await key('Tab', true);
  expect(marked()).toBe('- 学习\n\n    ```text\n    ¦record();\n    ```');
});
it('keeps pasted whitespace literal instead of applying input indentation', async () => {
  const view = await mount(
    '```python\n¦\n```',
    { codeIndentSize: 8, codeIndentStyle: 'tabs' },
    'source',
    'python',
  );
  const inserted = 'if ready:\n  old_spaces()\n\told_tab()';
  await act(async () =>
    view.dispatch(view.state.replaceSelection(inserted), { userEvent: 'input.paste' }),
  );
  expect(view.state.doc.toString()).toBe(`\`\`\`python\n${inserted}\n\`\`\``);
});
it('keeps the ordinary paragraph Tab fallback at two spaces', async () => {
  await mount('正文¦', { codeIndentSize: 8, codeIndentStyle: 'tabs' });
  await key('Tab');
  expect(marked()).toBe('  正文¦');
});
it('joins code lines normally when Backspace is pressed at column zero', async () => {
  await mount('```text\nfirst\n¦second\n```');
  await key('Backspace');
  expect(marked()).toBe('```text\nfirst¦second\n```');
});
it('accepts the selected completion with Tab before inserting indentation', async () => {
  const view = new EditorView({
    parent: host,
    doc: '```text\nre\n```',
    selection: { anchor: 10 },
    extensions: [
      markdown(),
      codeIndentation(defaultSettings),
      autocompletion({
        override: [
          (context) => ({
            from: context.pos - 2,
            options: [{ label: 'recordValue', type: 'function' }],
          }),
        ],
        interactionDelay: 0,
      }),
    ],
  });
  try {
    view.focus();
    startCompletion(view);
    await vi.waitFor(() => expect(selectedCompletion(view.state)?.label).toBe('recordValue'));
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe('```text\nrecordValue\n```');
    expect(view.state.selection.main.head).toBe(19);
  } finally {
    view.destroy();
  }
});
it('moves through snippet parameters before changing indentation', async () => {
  const view = await mount('```text\n¦\n```');
  await act(async () => snippet('call(${first}, ${second})${}')(view, null, 8, 8));
  await key('Tab');
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
    'second',
  );
  await key('Tab', true);
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
    'first',
  );
  expect(view.state.doc.toString()).toBe('```text\ncall(first, second)\n```');
});
