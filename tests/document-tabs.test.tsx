// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentTabs } from '../src/components/DocumentTabs';
import { makeDraft } from '../src/ui/model';
import type { ViewTab } from '../src/shared/types';
let host: HTMLDivElement, root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});
const order: ViewTab[] = [{ kind: 'note', id: 'A' }, { kind: 'graph' }, { kind: 'note', id: 'B' }];
function rect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    top: 0,
    right: left + width,
    bottom: 44,
    width,
    height: 44,
    toJSON() {
      return {};
    },
  };
}
function pointer(target: EventTarget, type: string, x: number, y = 20) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onSelect = vi.fn(),
    onClose = vi.fn(),
    onReorder = vi.fn();
  await act(async () =>
    root.render(
      <DocumentTabs
        tabs={['A', 'B'].map((id) => ({ ...makeDraft(id, id), id }))}
        order={order}
        activeId="A"
        graphActive={false}
        scroller={createRef()}
        menuOpen={false}
        onMenu={() => {}}
        onSelect={onSelect}
        onClose={onClose}
        onNew={() => {}}
        onReorder={onReorder}
      />,
    ),
  );
  const bar = host.querySelector<HTMLElement>('.tabs-bar')!;
  bar.getBoundingClientRect = () => rect(0, 450);
  [...host.querySelectorAll<HTMLElement>('.document-tab')].forEach(
    (el, index) => (el.getBoundingClientRect = () => rect(index * 140, 140)),
  );
  return { onSelect, onClose, onReorder };
}
it('reorders an inactive note only on release, includes graph and suppresses the drag click', async () => {
  const callbacks = await mount();
  const tab = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2];
  await act(async () => pointer(tab, 'pointerdown', 350));
  await act(async () => pointer(window, 'pointermove', 15));
  expect(callbacks.onReorder).not.toHaveBeenCalled();
  expect(host.querySelector('.tab-insertion-marker')).not.toBeNull();
  expect(callbacks.onSelect).not.toHaveBeenCalled();
  await act(async () => pointer(window, 'pointerup', 15));
  expect(callbacks.onReorder).toHaveBeenCalledWith([order[2], order[0], order[1]]);
  await act(async () => tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  expect(callbacks.onSelect).not.toHaveBeenCalled();
  expect(host.querySelector('.tab-insertion-marker')).toBeNull();
});
it('allows keyboard activation after a completed or cancelled drag without another pointer down', async () => {
  const callbacks = await mount();
  const tab = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2];
  await act(async () => {
    pointer(tab, 'pointerdown', 350);
    pointer(window, 'pointermove', 15);
    pointer(window, 'pointerup', 15);
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  });
  expect(callbacks.onSelect).toHaveBeenCalledWith(order[2]);
});
it.each(['escape', 'outside', 'cancel'])(
  'cancels a drag by %s without changing order or active note',
  async (kind) => {
    const callbacks = await mount();
    const tab = host.querySelector<HTMLButtonElement>('[role="tab"]')!;
    await act(async () => {
      pointer(tab, 'pointerdown', 50);
      pointer(window, 'pointermove', 350);
    });
    await act(async () => {
      if (kind === 'escape')
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (kind === 'cancel') pointer(window, 'pointercancel', 350);
      else pointer(window, 'pointerup', 350, 100);
    });
    expect(callbacks.onReorder).not.toHaveBeenCalled();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(host.querySelector('.tab-insertion-marker')).toBeNull();
  },
);
it('leaves ordinary click and close behavior intact below the drag threshold', async () => {
  const callbacks = await mount();
  const tab = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2];
  await act(async () => {
    pointer(tab, 'pointerdown', 350);
    pointer(window, 'pointermove', 352);
    pointer(window, 'pointerup', 352);
    tab.click();
  });
  expect(callbacks.onSelect).toHaveBeenCalledWith(order[2]);
  const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭 B"]')!;
  await act(async () => {
    pointer(close, 'pointerdown', 350);
    pointer(window, 'pointermove', 15);
    pointer(window, 'pointerup', 15);
    close.click();
  });
  expect(callbacks.onReorder).not.toHaveBeenCalled();
  expect(callbacks.onClose).toHaveBeenCalledWith(order[2]);
});
