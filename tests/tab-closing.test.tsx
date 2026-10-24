// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabClosing, type CloseDecision, type TabClosingOptions } from '../src/ui/useTabClosing';
import type { TabState } from '../src/shared/types';

let host: HTMLDivElement;
let root: Root;
let closing: ReturnType<typeof useTabClosing>;
let tabs: Map<string, TabState>;
let options: TabClosingOptions;
const tab = (
  id: string,
  dirty = false,
  file: string | null = `D:/generated/${id}.md`,
): TabState => ({
  id,
  title: id,
  path: file,
  content: dirty ? '未保存内容' : '正文',
  baseContent: '正文',
  hash: 'generated',
  modifiedAt: 1,
  dirty,
  cursor: 3,
  scrollTop: 90,
  mode: 'live',
});
function Harness() {
  closing = useTabClosing(options);
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  tabs = new Map([
    ['A', tab('A')],
    ['B', tab('B')],
    ['C', tab('C')],
  ]);
  options = {
    getTab: (id) => tabs.get(id),
    save: vi.fn(async (id) => {
      const latest = tabs.get(id)!;
      tabs.set(id, { ...latest, dirty: false, path: latest.path ?? `D:/generated/${id}.md` });
      return true;
    }),
    removeTab: vi.fn((id) => {
      tabs.delete(id);
    }),
    onClosed: vi.fn(),
    notify: vi.fn(),
    confirm: vi.fn(async (): Promise<CloseDecision> => 'save'),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(<Harness />));
}
async function close(id: string) {
  let result = false;
  await act(async () => {
    result = await closing.requestClose(id);
  });
  return result;
}
async function batch(ids: string[]) {
  let result = false;
  await act(async () => {
    result = await closing.requestCloseMany(ids);
  });
  return result;
}

describe('tab closing keeps confirmation and saving ahead of removal', () => {
  it('captures a clean tab before removing it and does not show a confirmation', async () => {
    const order: string[] = [];
    options.onClosed = vi.fn((current) => {
      expect(tabs.has(current.id)).toBe(true);
      order.push('capture');
    });
    options.removeTab = vi.fn((id) => {
      order.push('remove');
      tabs.delete(id);
    });
    await mount();
    expect(await close('A')).toBe(true);
    expect(order).toEqual(['capture', 'remove']);
    expect(options.confirm).not.toHaveBeenCalled();
    expect(closing.isClosing).toBe(false);
  });
  it('confirms named dirty tabs and uses the latest saved snapshot for onClosed', async () => {
    tabs.set('A', tab('A', true));
    await mount();
    expect(await close('A')).toBe(true);
    expect(options.confirm).toHaveBeenCalledOnce();
    expect(options.save).toHaveBeenCalledWith('A', true);
    expect(options.onClosed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'A', dirty: false }),
      'save',
    );
  });
  it('confirms an unnamed nonempty draft even if its dirty flag is false, and passes explicit discard', async () => {
    tabs.set('A', { ...tab('A', false, null), content: '必须明确处理的草稿' });
    options.confirm = vi.fn(async (): Promise<CloseDecision> => 'discard');
    await mount();
    expect(await close('A')).toBe(true);
    expect(options.onClosed).toHaveBeenCalledWith(
      expect.objectContaining({ path: null }),
      'discard',
    );
    expect(options.save).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'save-false', 'still-dirty', 'save-throws'] as const)(
    'stops a sequential batch on %s and preserves the remaining tabs',
    async (failure) => {
      tabs.set('A', tab('A', true));
      if (failure === 'cancel')
        options.confirm = vi.fn(async (): Promise<CloseDecision> => 'cancel');
      else if (failure === 'save-false') options.save = vi.fn(async () => false);
      else if (failure === 'still-dirty') options.save = vi.fn(async () => true);
      else
        options.save = vi.fn(async () => {
          throw new Error('生成保存失败');
        });
      await mount();
      expect(await batch(['A', 'B', 'C'])).toBe(false);
      expect([...tabs.keys()]).toEqual(['A', 'B', 'C']);
      expect(options.removeTab).not.toHaveBeenCalled();
      expect(options.onClosed).not.toHaveBeenCalled();
      expect(options.confirm).toHaveBeenCalledOnce();
      expect(closing.isClosing).toBe(false);
      if (failure === 'still-dirty')
        expect(options.notify).toHaveBeenCalledWith(expect.stringMatching(/新修改|未保存/));
      if (failure === 'save-throws')
        expect(options.notify).toHaveBeenCalledWith(expect.stringContaining('生成保存失败'), true);
    },
  );
  it('waits for each close before opening the next confirmation and rejects reentrant requests', async () => {
    tabs.set('A', tab('A', true));
    tabs.set('B', tab('B', true));
    let answer!: (decision: CloseDecision) => void;
    options.confirm = vi.fn(
      () =>
        new Promise<CloseDecision>((resolve) => {
          answer = resolve;
        }),
    );
    await mount();
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = closing.requestCloseMany(['A', 'B', 'C']);
    });
    expect(closing.isClosing).toBe(true);
    expect(options.confirm).toHaveBeenCalledOnce();
    expect(await close('C')).toBe(false);
    await act(async () => answer('discard'));
    expect(options.confirm).toHaveBeenCalledTimes(2);
    expect([...tabs.keys()]).toEqual(['B', 'C']);
    await act(async () => {
      answer('cancel');
      expect(await pending).toBe(false);
    });
    expect([...tabs.keys()]).toEqual(['B', 'C']);
    expect(closing.isClosing).toBe(false);
  });
  it('keeps newly typed content when saving finishes but the current tab is still dirty', async () => {
    tabs.set('A', tab('A', true));
    let finish!: (saved: boolean) => void;
    options.save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = closing.requestClose('A');
    });
    tabs.set('A', { ...tabs.get('A')!, content: '保存过程中新增输入', dirty: true });
    await act(async () => {
      finish(true);
      expect(await pending).toBe(false);
    });
    expect(tabs.get('A')?.content).toBe('保存过程中新增输入');
    expect(options.removeTab).not.toHaveBeenCalled();
  });
  it('does not remove a tab when the before-removal capture fails', async () => {
    options.onClosed = vi.fn(() => {
      throw new Error('生成关闭快照失败');
    });
    await mount();
    expect(await batch(['A', 'B'])).toBe(false);
    expect(options.removeTab).not.toHaveBeenCalled();
    expect(options.notify).toHaveBeenCalledWith(expect.stringContaining('生成关闭快照失败'), true);
    expect([...tabs.keys()]).toEqual(['A', 'B', 'C']);
  });
  it.each(['confirm', 'save'] as const)(
    'cancels an unresolved %s wait on unmount without late removal',
    async (stage) => {
      tabs.set('A', tab('A', true));
      let finish!: () => void;
      if (stage === 'confirm')
        options.confirm = vi.fn(
          () =>
            new Promise<CloseDecision>((resolve) => {
              finish = () => resolve('discard');
            }),
        );
      else
        options.save = vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              finish = () => resolve(true);
            }),
        );
      await mount();
      let pending!: Promise<boolean>;
      await act(async () => {
        pending = closing.requestClose('A');
      });
      await act(async () => root.render(null));
      expect(await pending).toBe(false);
      await act(async () => {
        finish();
        await Promise.resolve();
      });
      expect(options.removeTab).not.toHaveBeenCalled();
      expect(options.onClosed).not.toHaveBeenCalled();
      expect(options.notify).not.toHaveBeenCalled();
    },
  );
  it('stops when the saved target disappeared instead of acting on another active tab', async () => {
    tabs.set('A', tab('A', true));
    options.save = vi.fn(async () => {
      tabs.delete('A');
      return true;
    });
    await mount();
    expect(await batch(['A', 'B'])).toBe(false);
    expect(tabs.has('B')).toBe(true);
    expect(options.onClosed).not.toHaveBeenCalled();
  });
  it('closes the captured batch order once per id and permits another request after completion', async () => {
    await mount();
    expect(await batch(['B', 'B', 'A'])).toBe(true);
    expect(vi.mocked(options.removeTab).mock.calls.map(([id]) => id)).toEqual(['B', 'A']);
    expect(await close('C')).toBe(true);
    expect(tabs.size).toBe(0);
  });
  it.each(['confirm', 'remove'] as const)(
    'stops the batch when %s throws and allows a later retry',
    async (stage) => {
      if (stage === 'confirm') {
        tabs.set('A', tab('A', true));
        options.confirm = vi.fn(async () => {
          throw new Error('生成确认失败');
        });
      } else
        options.removeTab = vi.fn(() => {
          throw new Error('生成移除失败');
        });
      await mount();
      expect(await batch(['A', 'B'])).toBe(false);
      expect([...tabs.keys()]).toEqual(['A', 'B', 'C']);
      expect(options.notify).toHaveBeenCalledWith(expect.stringContaining('生成'), true);
      options.confirm = vi.fn(async (): Promise<CloseDecision> => 'discard');
      options.removeTab = vi.fn((id) => {
        tabs.delete(id);
      });
      expect(await close('A')).toBe(true);
      expect(tabs.has('B')).toBe(true);
    },
  );
  it('uses the latest callbacks after a confirmation spans a rerender', async () => {
    tabs.set('A', tab('A', true));
    let answer!: (decision: CloseDecision) => void;
    options.confirm = vi.fn(
      () =>
        new Promise<CloseDecision>((resolve) => {
          answer = resolve;
        }),
    );
    const old = options.onClosed;
    await mount();
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = closing.requestClose('A');
    });
    const fresh = vi.fn();
    options = { ...options, onClosed: fresh };
    await act(async () => root.render(<Harness />));
    await act(async () => {
      answer('discard');
      expect(await pending).toBe(true);
    });
    expect(fresh).toHaveBeenCalledOnce();
    expect(old).not.toHaveBeenCalled();
  });
  it('remains usable after StrictMode lifecycle cleanup and remount', async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    expect(await close('A')).toBe(true);
    expect(tabs.has('A')).toBe(false);
  });
});
