// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuickOpenPanel } from '../src/components/QuickOpenPanel';
import type { NoteMeta } from '../src/shared/types';
import { makeDraft } from '../src/ui/model';

let host: HTMLDivElement, root: Root;
const tabs = [
  { ...makeDraft('正文', 'Alpha'), id: 'alpha', path: 'D:\\notes\\Alpha.md' },
  { ...makeDraft('', '草稿'), id: 'draft' },
];
const note = (path: string, title: string): NoteMeta => ({
  path,
  title,
  tags: [],
  links: [],
  headings: [],
  modifiedAt: 1,
});
const index = [note('d:/NOTES/alpha.md', '重复 Alpha'), note('D:/notes/project/Beta.md', 'Beta')];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(busy = false, notes = index) {
  const onSelect = vi.fn(),
    onClose = vi.fn();
  await act(async () =>
    root.render(
      <QuickOpenPanel
        tabs={tabs}
        index={notes}
        onSelect={onSelect}
        onClose={onClose}
        busy={busy}
      />,
    ),
  );
  return { onSelect, onClose, input: host.querySelector<HTMLInputElement>('input')! };
}
async function search(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(input: HTMLInputElement, value: string, composing = false) {
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, isComposing: composing }),
    ),
  );
}
it('deduplicates opened Windows paths and keeps drafts selectable with keyboard', async () => {
  const { input, onSelect } = await render();
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
  expect(document.activeElement).toBe(input);
  await key(input, 'ArrowDown');
  await key(input, 'Enter');
  expect(onSelect).toHaveBeenCalledWith({ kind: 'tab', id: 'draft' });
});
it('matches a path and opens the indexed file without changing its path', async () => {
  const { input, onSelect } = await render();
  await search(input, 'PROJECT\\beta');
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  await key(input, 'Enter');
  expect(onSelect).toHaveBeenCalledWith({ kind: 'file', path: 'D:/notes/project/Beta.md' });
});
it('does not open a note during IME confirmation or while busy', async () => {
  const { input, onSelect } = await render();
  await key(input, 'Enter', true);
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  );
  await key(input, 'Enter');
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
  );
  const busy = await render(true);
  await key(busy.input, 'Enter');
  await act(async () => host.querySelector<HTMLElement>('[role="option"]')!.click());
  expect(busy.onSelect).not.toHaveBeenCalled();
  expect(busy.input.disabled).toBe(true);
});
it('caps rendered matches and reports the full count, then narrows without losing the query', async () => {
  const { input } = await render(
    false,
    Array.from({ length: 150 }, (_, i) => note(`D:/notes/${i}.md`, `Indexed ${i}`)),
  );
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(100);
  expect(host.textContent).toContain('152 篇匹配笔记');
  expect(host.textContent).toContain('请继续输入缩小范围');
  await search(input, 'Indexed 149');
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(input.value).toBe('Indexed 149');
});
it('allows Escape cancellation after searching without an unsaved-form confirmation', async () => {
  const { input, onClose } = await render();
  await search(input, '不存在');
  await key(input, 'Enter');
  expect(host.textContent).toContain('没有匹配的笔记');
  await act(async () =>
    host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain('放弃输入并关闭');
});
