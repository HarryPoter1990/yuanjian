import { describe, expect, it } from 'vitest';
import {
  acceptSave,
  appearanceColors,
  asTab,
  dateKey,
  makeDraft,
  matchesShortcut,
  relativeNoteTarget,
  markdownLink,
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
    const { tab: saved } = acceptSave(tab, '第一次输入', {
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
    const { tab: merged } = acceptSave(tab, tab.content, {
      status: 'saved',
      note: { ...note, content: '我的修改\n外部修改' },
      merged: true,
    });
    expect(merged.content).toBe('我的修改\n外部修改');
    expect(merged.dirty).toBe(false);
    expect(acceptSave(tab, tab.content, { status: 'cancelled' }).tab).toBe(tab);
    expect(acceptSave(tab, tab.content, { status: 'conflict' }).tab).toBe(tab);
  });
  it('treats CRLF and LF as the same document when accepting a save', () => {
    const tab = { ...asTab(note), content: '第一行\n第二行\n', dirty: true };
    const saved = acceptSave(tab, '第一行\r\n第二行\r\n', {
      status: 'saved',
      note: { ...note, content: '第一行\r\n第二行\r\n', hash: 'saved' },
    });
    expect(saved.conflict).toBeUndefined();
    expect(saved.tab.dirty).toBe(false);
    expect(saved.tab.content).toBe('第一行\r\n第二行\r\n');
  });
  it('does not mark lone-CR document normalization as a later edit', () => {
    const tab = { ...asTab(note), content: '第一行\n第二行\n', dirty: true };
    const saved = acceptSave(tab, '第一行\r第二行\r', {
      status: 'saved',
      note: { ...note, content: '第一行\r第二行\r', hash: 'saved' },
    });
    expect(saved.conflict).toBeUndefined();
    expect(saved.tab.dirty).toBe(false);
    expect(saved.tab.content).toBe('第一行\r第二行\r');
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
      background: '#191919',
      foreground: '#EEEEEE',
      accent: '#9FB59E',
    });
    expect(appearanceColors({ ...defaultAppearance, mode: 'system' }, true).dark).toBe(true);
    expect(
      appearanceColors({ ...defaultAppearance, mode: 'dark', accent: '#abcdef' }, false).accent,
    ).toBe('#abcdef');
  });
  it('defaults to relative note paths within a drive, including Chinese folders and spaces', () => {
    expect(relativeNoteTarget('D:\\资料\\日记\\今天.md', 'D:\\资料\\学习\\目标 笔记.md')).toBe(
      '../学习/目标 笔记.md',
    );
    expect(relativeNoteTarget('D:\\资料\\今天.md', 'd:\\资料\\另一篇.md')).toBe('另一篇.md');
  });
  it('uses absolute paths across drives or UNC shares', () => {
    expect(relativeNoteTarget('D:\\资料\\今天.md', 'E:\\学习\\目标.md')).toBe('E:/学习/目标.md');
    expect(relativeNoteTarget('\\\\server\\share\\a\\源.md', '\\\\server\\share\\b\\目标.md')).toBe(
      '../b/目标.md',
    );
    expect(relativeNoteTarget('\\\\server\\share\\源.md', '\\\\server\\other\\目标.md')).toBe(
      '//server/other/目标.md',
    );
  });
  it('escapes link labels, protects spaces, and encodes drive letters for the safe renderer', () => {
    expect(markdownLink('目标[一]', '../学习/目标 笔记.md')).toBe(
      '[目标\\[一\\]](<../学习/目标 笔记.md>)',
    );
    expect(markdownLink('目标', 'E:\\学习\\目标.md')).toBe('[目标](E%3A/学习/目标.md)');
    expect(markdownLink('网站', 'https://example.test/a')).toBe('[网站](https://example.test/a)');
  });
});
