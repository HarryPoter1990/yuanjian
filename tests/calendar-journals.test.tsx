// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Sidebar } from '../src/components/Sidebar';
import { defaultSettings } from '../src/shared/defaults';
import { parseNote } from '../src/shared/markdown';
import { dateKey } from '../src/ui/model';

it('separates the configured daily note from unrelated date-named notes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const date = dateKey(new Date());
  const configured = `D:/generated/journals/${date.replaceAll('-', '/')}.md`;
  const unrelated = `D:/generated/course/lecture-${date}.md`;
  const settings = {
    ...structuredClone(defaultSettings),
    journalDirectory: 'D:/generated/journals',
    dailyPattern: '{{year}}/{{month}}/{{day}}.md',
  };
  const open = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Sidebar
          settings={settings}
          trees={{}}
          index={[parseNote('# 我的日记', configured, 1), parseNote('# 课堂记录', unrelated, 1)]}
          activePath={null}
          onSettings={() => {}}
          onOpen={open}
          onNew={() => {}}
          onJournal={() => {}}
          onError={() => {}}
        />,
      ),
    );
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
      )!;
    await act(async () => button('更多导航').click());
    await act(async () => button('日历').click());
    const diary = host.querySelector('[aria-label="当日日记"]');
    const related = host.querySelector('[aria-label="相关日期笔记"]');
    expect(diary?.textContent).toContain('我的日记');
    expect(diary?.textContent).not.toContain('课堂记录');
    expect(related?.textContent).toContain('课堂记录');
    await act(async () => button('我的日记').click());
    expect(open).toHaveBeenCalledWith(configured);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
