// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { EditorCommand, MarkdownEditorHandle } from '../src/editor/types';
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
async function mount(value: string, anchor = 0, head = anchor) {
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={value}
        mode="source"
        settings={defaultSettings}
        onChange={() => {}}
      />,
    ),
  );
  const view = ref.current!.getView()!;
  await act(async () => view.dispatch({ selection: { anchor, head } }));
  return view;
}
async function command(value: EditorCommand) {
  await act(async () => ref.current!.command(value));
}
describe('format actions respect selected source and existing styles', () => {
  it.each(['bold', 'italic'] as const)(
    'formats separate paragraphs with %s and toggles the whole selection back',
    async (kind) => {
      const source = '# 标题\n\n第一段\n\n- 第二段\n\n$$\nx^2\n$$\n\n```js\nconst x=1\n```';
      const view = await mount(source, 0, source.length);
      await command(kind);
      const mark = kind === 'bold' ? '**' : '*';
      expect(view.state.doc.toString()).toBe(
        `# ${mark}标题${mark}\n\n${mark}第一段${mark}\n\n- ${mark}第二段${mark}\n\n$$\nx^2\n$$\n\n\`\`\`js\nconst x=1\n\`\`\``,
      );
      await command(kind);
      expect(view.state.doc.toString()).toBe(source);
      await command('undo');
      expect(view.state.doc.toString()).toContain(`${mark}第一段${mark}`);
    },
  );
  it('unifies mixed paragraph formatting and preserves a reversed partial selection', async () => {
    const source = '**甲段**\n\n乙段';
    const view = await mount(source, source.length, 0);
    await command('bold');
    expect(view.state.doc.toString()).toBe('**甲段**\n\n**乙段**');
    expect(view.state.selection.main.anchor > view.state.selection.main.head).toBe(true);
  });
  it('keeps underscore delimiter identity while removing bold from a partial range', async () => {
    const view = await mount('__abcdef__', 4, 6);
    await command('bold');
    expect(view.state.doc.toString()).toBe('__ab__cd__ef__');
  });
  it('joins mixed delimiter spans without leaving mismatched closing markers', async () => {
    const source = '__ab__ c **de**';
    const view = await mount(source, 3, source.indexOf('e'));
    await command('bold');
    expect(view.state.doc.toString()).toBe('__ab c d__**e**');
  });
  it('starts a requested heading or list on an empty body line and undoes one action at a time', async () => {
    const view = await mount('');
    await command('list');
    expect(view.state.doc.toString()).toBe('- ');
    await command('undo');
    expect(view.state.doc.toString()).toBe('');
    await act(async () => ref.current!.setHeading(2));
    expect(view.state.doc.toString()).toBe('## ');
  });
  it.each(['bold', 'italic'] as const)(
    'toggles %s twice and keeps the content selected',
    async (action) => {
      const view = await mount('abc', 0, 3);
      const mark = action === 'bold' ? '**' : '*';
      await command(action);
      expect(view.state.doc.toString()).toBe(mark + 'abc' + mark);
      expect(
        view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      ).toBe('abc');
      await command(action);
      expect(view.state.doc.toString()).toBe('abc');
      expect(
        view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      ).toBe('abc');
    },
  );
  it('removes an enclosing style at an empty caret rather than inserting empty nested markers', async () => {
    const view = await mount('**abc**', 3);
    await command('bold');
    expect(view.state.doc.toString()).toBe('abc');
    expect(view.state.selection.main.head).toBe(1);
  });
  it.each([false, true])(
    'locally removes bold from a partial range and preserves reversed=%s selection',
    async (reversed) => {
      const view = await mount('**abcdef**', reversed ? 6 : 4, reversed ? 4 : 6);
      await command('bold');
      expect(view.state.doc.toString()).toBe('**ab**cd**ef**');
      expect(
        view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      ).toBe('cd');
      expect(view.state.selection.main.anchor > view.state.selection.main.head).toBe(reversed);
    },
  );
  it('fills mixed bold content without nesting its existing markers', async () => {
    const source = '**已粗** 普通';
    const view = await mount(source, 0, source.length);
    await command('bold');
    expect(view.state.doc.toString()).toBe('**已粗 普通**');
  });
  it('does not remove literal bold markers inside inline code', async () => {
    const source = '`**code**` 普通';
    const view = await mount(source, 0, source.length);
    await command('bold');
    expect(view.state.doc.toString()).toBe('**`**code**` 普通**');
  });
  it('applies a list to the selected lines without including a line touched only at its start', async () => {
    const source = '甲\n- 乙\n丙\n\n尾段';
    const view = await mount(source, source.indexOf('丙'), 0);
    await command('list');
    expect(view.state.doc.toString()).toBe('- 甲\n- 乙\n丙\n\n尾段');
    expect(view.state.selection.main.anchor > view.state.selection.main.head).toBe(true);
    await command('list');
    expect(view.state.doc.toString()).toBe('甲\n乙\n丙\n\n尾段');
  });
  it('keeps existing task completion while filling a mixed selection and removes the format on a second action', async () => {
    const source = '- [x] 已完成\n普通';
    const view = await mount(source, 0, source.length);
    await command('task');
    expect(view.state.doc.toString()).toBe('- [x] 已完成\n- [ ] 普通');
    await command('task');
    expect(view.state.doc.toString()).toBe('已完成\n普通');
  });
  it('fills and removes quote prefixes across the selection without doubling existing ones', async () => {
    const source = '> 已引用\n普通';
    const view = await mount(source, 0, source.length);
    await command('quote');
    expect(view.state.doc.toString()).toBe('> 已引用\n> 普通');
    await command('quote');
    expect(view.state.doc.toString()).toBe('已引用\n普通');
  });
  it('leaves code and document properties untouched when a multi-line format spans them', async () => {
    const source = '---\ntags: [学习]\n---\n\n```js\nconst x = 1;\n```\n\n正文';
    const view = await mount(source, 0, source.length);
    await command('task');
    expect(view.state.doc.toString()).toBe(source.replace('正文', '- [ ] 正文'));
  });
  it('returns an ATX heading with closing markers to actual body text', async () => {
    const view = await mount('## 标题 ##', 4);
    await act(async () => ref.current!.setHeading(0));
    expect(view.state.doc.toString()).toBe('标题');
  });
});
