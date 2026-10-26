// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Sidebar } from '../src/components/Sidebar';
import { ShortcutControl } from '../src/components/ShortcutControl';
import { NoteSearch } from '../src/components/NoteSearch';
import { defaultSettings } from '../src/shared/defaults';
import { searchDocument } from '../src/shared/search';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text,
  )!;
async function type(field: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('preserves nested collapse through parent toggles and remount, with keyboard navigation', async () => {
  let saved = structuredClone(defaultSettings);
  saved.roots = ['D:/generated'];
  const trees = {
    'D:/generated': [
      {
        path: 'D:/generated/parent',
        name: 'parent',
        kind: 'directory' as const,
        children: [
          {
            path: 'D:/generated/parent/child',
            name: 'child',
            kind: 'directory' as const,
            children: [
              { path: 'D:/generated/parent/child/note.md', name: 'note.md', kind: 'note' as const },
            ],
          },
        ],
      },
    ],
  };
  const opened = vi.fn();
  function Fixture() {
    const [settings, setSettings] = useState(saved);
    return (
      <Sidebar
        settings={settings}
        trees={trees}
        index={[]}
        activePath={null}
        onSettings={(next) => {
          saved = next;
          setSettings(next);
        }}
        onOpen={opened}
        onNew={() => {}}
        onJournal={() => {}}
        onError={(error) => {
          throw Error(error);
        }}
      />
    );
  }
  await act(async () => root.render(<Fixture />));
  await act(async () => button('child').click());
  await act(async () => button('parent').click());
  await act(async () => button('parent').click());
  expect(button('child').getAttribute('aria-expanded')).toBe('false');
  expect(button('note.md')).toBeUndefined();
  await act(async () => root.render(<Fixture key="restarted" />));
  expect(button('child').getAttribute('aria-expanded')).toBe('false');
  await act(async () => {
    button('child').focus();
    button('child').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
  });
  await act(async () =>
    button('child').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(button('note.md'));
  await act(async () =>
    button('note.md').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  expect(opened).toHaveBeenCalledWith('D:/generated/parent/child/note.md');
});
it('retains original shortcut bindings until an explicit replacement, and refuses fixed keys', async () => {
  let bindings: Record<string,string> = { save: 'Ctrl+s', new: 'Ctrl+n' };
  function Fixture() {
    const [value, setValue] = useState(bindings);
    return (
      <ShortcutControl
        action="save"
        bindings={value}
        defaultValue="Ctrl+s"
        onChange={(next) => {
          bindings = next;
          setValue(next);
        }}
      />
    );
  }
  await act(async () => root.render(<Fixture />));
  const input = host.querySelector('input')!;
  await type(input, 'Ctrl+w');
  expect(bindings.save).toBe('Ctrl+s');
  expect(host.textContent).toContain('关闭当前笔记');
  expect(button('替换原绑定')).toBeUndefined();
  await type(input, 'Ctrl+Home');
  expect(bindings.save).toBe('Ctrl+s');
  expect(host.textContent).toContain('文档开头');
  await type(input, 'Ctrl+n');
  expect(bindings.new).toBe('Ctrl+n');
  await act(async () => button('替换原绑定').click());
  expect(bindings).toEqual({ save: 'Ctrl+n', new: '' });
});
it('removes old query results immediately and searches the current draft without saving', async () => {
  vi.useFakeTimers();
  const query = vi.fn(async () => ({
    notes: [
      searchDocument('旧词', { path: 'D:/notes/old.md', title: 'old', content: '旧词', tags: [] })!,
    ],
    issues: [],
    truncated: false,
  }));
  const activate = vi.fn();
  window.notes = {
    searchNotes: query,
    cancelSearch: vi.fn(async () => {}),
  } as unknown as typeof window.notes;
  const draft = {
    id: 'draft',
    path: null,
    title: '草稿',
    content: '新词',
    baseContent: '',
    hash: '',
    modifiedAt: 0,
    dirty: true,
    cursor: 0,
    scrollTop: 0,
    mode: 'live' as const,
  };
  await act(async () =>
    root.render(
      <NoteSearch
        roots={['D:/notes']}
        tabs={[draft]}
        revision={0}
        focusVersion={0}
        onOpen={() => {}}
        onActivate={activate}
      />,
    ),
  );
  const input = host.querySelector('input')!;
  await type(input, '旧词');
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.textContent).toContain('old.md');
  await type(input, '新词');
  expect(host.textContent).not.toContain('old.md');
  expect(host.querySelector('mark')?.textContent).toBe('新词');
  await act(async () => host.querySelector<HTMLButtonElement>('.search-result')!.click());
  expect(activate).toHaveBeenCalledWith('draft', 1);
});
