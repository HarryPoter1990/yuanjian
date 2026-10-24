// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AttachmentPanel } from '../src/components/RecoveryPanels';
import type { AttachmentCandidate, DesktopAPI } from '../src/shared/types';

let host: HTMLDivElement, root: Root;
const safe = { path: 'D:/generated/unused.png', bytes: 12, references: [] };
let items: AttachmentCandidate[];
let fail: boolean;
let trash: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  items = [safe];
  fail = false;
  trash = vi.fn(async () => {});
  window.notes = {
    scanAttachments: async () => {
      if (fail) throw Error('生成扫描失败');
      return structuredClone(items);
    },
    trashAttachments: trash,
  } as unknown as DesktopAPI;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () =>
    root.render(<AttachmentPanel onClose={() => {}} onError={() => {}} onSuccess={() => {}} />),
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
it('explains uncertain references and prevents selecting them for cleanup', async () => {
  items = [{ ...safe, uncertainReasons: ['生成笔记无法读取'] }];
  await mount();
  const checkbox = document.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(checkbox.disabled).toBe(true);
  expect(document.body.textContent).toContain('引用状态不确定');
  expect(document.body.textContent).toContain('生成笔记无法读取');
  expect(
    [...document.querySelectorAll('button')].find((b) => b.textContent === '将所选移入回收站')!
      .disabled,
  ).toBe(true);
  expect(trash).not.toHaveBeenCalled();
});
it('drops an old selection when a new scan finds its references uncertain', async () => {
  await mount();
  await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(document.body.textContent).toContain('已选 1 项');
  items = [{ ...safe, uncertainReasons: ['生成引用无法确认'] }];
  await click('重新扫描');
  expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  expect(document.body.textContent).toContain('已选 0 项');
  expect(trash).not.toHaveBeenCalled();
});
it('does not leave a stale deletion selection available after a failed rescan', async () => {
  await mount();
  await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  fail = true;
  await click('重新扫描');
  expect(document.body.textContent).toContain('生成扫描失败');
  expect(document.body.textContent).toContain('已选 0 项');
  expect(
    [...document.querySelectorAll('button')].find((b) => b.textContent === '将所选移入回收站')!
      .disabled,
  ).toBe(true);
  expect(trash).not.toHaveBeenCalled();
});
it('still cleans up a confirmed unused attachment through the explicit confirmation', async () => {
  await mount();
  await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await click('将所选移入回收站');
  await click('确认移入回收站');
  expect(trash).toHaveBeenCalledWith([safe.path]);
});
