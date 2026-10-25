// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import { parseTable } from '../src/editor/table';
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
  ref = createRef();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(source: string) {
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={source}
        mode="live"
        initialCursor={source.length}
        settings={defaultSettings}
        onChange={() => {}}
      />,
    ),
  );
  return ref.current!.getView()!;
}
const cell = (row = 1, column = 0) =>
  host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-row="${row}"][data-column="${column}"]`,
  )!;
async function key(input: HTMLElement, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => input.dispatchEvent(event));
  return event;
}
async function paste(input: HTMLElement, html: string, plain: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/html' ? html : plain), files: [] },
  });
  await act(async () => input.dispatchEvent(event));
  return event;
}
const multiline = '| A | B |\n| --- | --- |\n| first<br><br>second | 2 |\n\n尾段';
describe('multiline table editing and matrix paste', () => {
  it('shows stored safe breaks as actual textarea lines and retains literal code examples', async () => {
    await mount(multiline.replace('2 |', '`<br>` |'));
    expect(cell().tagName).toBe('TEXTAREA');
    expect(cell().value).toBe('first\n\nsecond');
    expect(cell(1, 1).value).toBe('`<br>`');
  });
  it('uses Shift+Enter for an immediately saved cell newline without replacing the focused node', async () => {
    const source = '| A |\n| --- |\n| ab |\n\n尾段';
    const view = await mount(source);
    const input = cell();
    input.focus();
    input.setSelectionRange(1, 1);
    const event = await key(input, 'Enter', { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(cell()).toBe(input);
    expect(input.value).toBe('a\nb');
    expect(input.selectionStart).toBe(2);
    expect(document.activeElement).toBe(input);
    expect(view.state.doc.toString()).toBe(source.replace('| ab |', '| a<br>b |'));
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe(source);
  });
  it('keeps ordinary Enter as completion and Escape as whole-cell restoration', async () => {
    const view = await mount(multiline);
    let input = cell();
    input.focus();
    await act(async () => {
      input.value = '新\n值';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.state.doc.toString()).toContain('新<br>值');
    await key(input, 'Escape');
    expect(view.state.doc.toString()).toBe(multiline);
    input = cell();
    input.focus();
    await key(input, 'Enter');
    expect(document.activeElement).not.toBe(input);
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'does not consume candidate confirmation with %j',
    async (flags) => {
      const view = await mount(multiline);
      const input = cell();
      input.focus();
      const event = await key(input, 'Enter', { shiftKey: true, ...flags });
      expect(event.defaultPrevented).toBe(false);
      expect(view.state.doc.toString()).toBe(multiline);
      expect(document.activeElement).toBe(input);
    },
  );
  it('keeps multiline plain text within the current cell rather than expanding rows', async () => {
    const view = await mount('| A | B |\n| --- | --- |\n| old | 2 |\n\n尾段');
    const input = cell();
    input.focus();
    input.setSelectionRange(0, input.value.length);
    await paste(input, '', '甲\n\n乙');
    expect(cell().value).toBe('甲\n\n乙');
    expect(view.state.doc.toString()).toContain('| 甲<br><br>乙 | 2 |');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it('keeps an explicit plain-text paste literal in the current cell even with HTML and TSV alternatives', async () => {
    const view = await mount('| A | B |\n| --- | --- |\n| old | 2 |\n\n尾段');
    const input = cell();
    input.focus();
    input.setSelectionRange(0, input.value.length);
    await key(input, 'v', { ctrlKey: true, shiftKey: true });
    await paste(input, '<table><tr><td>rich</td><td>table</td></tr></table>', '甲\t乙\n丙');
    expect(cell().value).toBe('甲\t乙\n丙');
    expect(view.state.doc.toString()).toContain('甲\t乙<br>丙');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it('does not delete selected cell content for an empty or completely stripped clipboard representation', async () => {
    const source = '| A | B |\n| --- | --- |\n| old | 2 |\n\n尾段';
    const view = await mount(source);
    const input = cell();
    input.focus();
    input.setSelectionRange(0, input.value.length);
    await paste(input, '<script>evil()</script>', '');
    expect(view.state.doc.toString()).toBe(source);
    expect(cell().value).toBe('old');
  });
  it('pastes a clear HTML matrix from the current cell, expands dimensions and does not insert an artificial header', async () => {
    const view = await mount('| A | B |\n| --- | --- |\n| keep | |\n\n尾段');
    const input = cell(1, 1);
    input.focus();
    await paste(
      input,
      '<table><tr><td>x</td><td>y</td></tr><tr><td>z</td><td>w</td></tr></table>',
      'x\ty\nz\tw',
    );
    expect(parseTable(view.state.doc.toString().split('\n\n尾段')[0])?.rows).toEqual([
      ['A', 'B', ''],
      ['keep', 'x', 'y'],
      ['', 'z', 'w'],
    ]);
  });
  it('asks before a matrix overwrites values, supports cancellation, and applies as one undo step', async () => {
    const source = '| A | B |\n| --- | --- |\n| keep | old |\n\n尾段';
    const view = await mount(source);
    let input = cell(1, 1);
    input.focus();
    await paste(input, '', 'x\ty');
    expect(view.state.doc.toString()).toBe(source);
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '取消')!
        .click(),
    );
    expect(view.state.doc.toString()).toBe(source);
    expect(document.activeElement).toBe(cell(1, 1));
    input = cell(1, 1);
    await paste(input, '', 'x\ty');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '覆盖并粘贴')!
        .click(),
    );
    expect(view.state.doc.toString()).toContain('| keep | x | y |');
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe(source);
  });
  it('refuses a pending matrix after source changes rather than overwriting newer input', async () => {
    const view = await mount('| A | B |\n| --- | --- |\n| keep | old |\n\n尾段');
    const input = cell(1, 1);
    input.focus();
    await paste(input, '', 'x\ty');
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '覆盖并粘贴',
    )!;
    expect(confirm).toBeDefined();
    await act(async () => {
      input.value = '后来输入';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => confirm.click());
    expect(view.state.doc.toString()).toContain('后来输入');
    expect(view.state.doc.toString()).not.toContain('| x |');
  });
  it('uses the editor undo history from a focused cell and keeps matrix paste separate from earlier typing', async () => {
    const source = '| A | B |\n| --- | --- |\n| keep | old |\n\n尾段';
    const view = await mount(source);
    let input = cell(1, 1);
    input.focus();
    await act(async () => {
      input.value = 'earlier typing';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await paste(input, '', 'x\ty');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '覆盖并粘贴')!
        .click(),
    );
    input = cell(1, 1);
    const undoKey = await key(input, 'z', { ctrlKey: true });
    expect(undoKey.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(source.replace('old', 'earlier typing'));
    const redoKey = await key(cell(1, 1), 'y', { ctrlKey: true });
    expect(redoKey.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toContain('| keep | x | y |');
  });
  it('dispatches whole-table copy with exact current source and positions', async () => {
    const source = '| A | B |\n| --- | --- |\n| one | two |\n\n尾段';
    await mount(source);
    const copies: unknown[] = [];
    host.addEventListener('yuanjian:copy-table', (event) =>
      copies.push((event as CustomEvent).detail),
    );
    const button = [...host.querySelectorAll<HTMLButtonElement>('.table-toolbar button')].find(
      (button) => button.textContent === '复制整表',
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(copies).toEqual([
      { from: 0, to: source.indexOf('\n\n尾段'), source: source.split('\n\n尾段')[0] },
    ]);
  });
});
