import { describe, expect, it } from 'vitest';
import {
  acceptSave,
  appearanceColors,
  asTab,
  dateKey,
  makeDraft,
  matchesShortcut,
} from '../src/ui/model';
import { defaultAppearance } from '../src/shared/defaults';
import type { NoteDocument } from '../src/shared/types';

const note: NoteDocument = {
  id: 'disk-id',
  path: 'D:\\笔记\\学习.md',
  title: '学习.md',
  content: '原文',
  hash: 'before',
  modifiedAt: 1,
};
describe('UI document model', () => {
  it('keeps the exact source and starts recoverable unnamed drafts', () => {
    const tab = makeDraft('中文\r\n  - 内容\r\n');
    expect(tab.path).toBeNull();
    expect(tab.dirty).toBe(true);
    expect(tab.content).toBe('中文\r\n  - 内容\r\n');
    expect(makeDraft().dirty).toBe(false);
  });
  it('does not lose edits made while an earlier save is in flight', () => {
    const tab = { ...asTab(note), content: '更新后的第二次输入', dirty: true };
    const saved = acceptSave(tab, '第一次输入', {
      status: 'saved',
      note: { ...note, content: '第一次输入', hash: 'after' },
    });
    expect(saved.content).toBe('更新后的第二次输入');
    expect(saved.baseContent).toBe('第一次输入');
    expect(saved.hash).toBe('after');
    expect(saved.dirty).toBe(true);
    expect(saved.id).toBe(tab.id);
  });
  it('accepts a clean merged save and leaves cancelled/conflicting saves intact', () => {
    const tab = { ...asTab(note), content: '我的修改', dirty: true };
    const merged = acceptSave(tab, tab.content, {
      status: 'saved',
      note: { ...note, content: '我的修改\n外部修改' },
      merged: true,
    });
    expect(merged.content).toBe('我的修改\n外部修改');
    expect(merged.dirty).toBe(false);
    expect(acceptSave(tab, tab.content, { status: 'cancelled' })).toBe(tab);
    expect(acceptSave(tab, tab.content, { status: 'conflict' })).toBe(tab);
  });
  it('matches exact modifiers and respects local calendar dates', () => {
    expect(
      matchesShortcut(
        { key: 'S', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
        'Ctrl+Shift+s',
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        { key: 's', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
        'Ctrl+s',
      ),
    ).toBe(false);
    expect(dateKey(new Date(2026, 0, 2, 0, 3))).toBe('2026-01-02');
  });
  it('keeps dark mode, system mode, graph colors and themed exports consistent', () => {
    expect(appearanceColors({ ...defaultAppearance, mode: 'dark' }, false)).toMatchObject({
      background: '#1c2227',
      foreground: '#e1e6e9',
      accent: '#87b9a5',
    });
    expect(appearanceColors({ ...defaultAppearance, mode: 'system' }, true).dark).toBe(true);
    expect(
      appearanceColors({ ...defaultAppearance, mode: 'dark', accent: '#abcdef' }, false).accent,
    ).toBe('#abcdef');
  });
});
