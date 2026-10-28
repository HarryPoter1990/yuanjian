import { expect, it } from 'vitest';
import {
  absoluteNoteReference,
  clipboardFileReference,
  clipboardNoteReference,
} from '../src/shared/note-path';
it.each([
  ['images/图.png', 'C:\\学习 笔记\\child.md', 'C:/学习 笔记/images/图.png'],
  ['../图%23一.png', 'D:\\notes\\sub\\child.md', 'D:/notes/图#一.png'],
  ['../图.png', '/notes/sub/child.md', '/notes/图.png'],
  ['../图.png', '\\\\server\\share\\sub\\child.md', '//server/share/图.png'],
  ['https://example.com/a.png', 'C:/notes/root.md', 'https://example.com/a.png'],
])('keeps embedded asset origins for %s', (reference, from, expected) => {
  expect(absoluteNoteReference(reference, from)).toBe(expected);
});
it.each([
  ['other.md#标题', 'D%3A/generated/sub/other.md#标题'],
  ['part%23one.md#^ref', 'D%3A/generated/sub/part%23one.md#^ref'],
  ['#标题', 'D%3A/generated/sub/child.md#标题'],
  ['mailto:student@example.com', 'mailto:student@example.com'],
  ['https://example.com/#part', 'https://example.com/#part'],
])('keeps link origins and fragments for %s', (reference, expected) => {
  expect(clipboardNoteReference(reference, 'D:/generated/sub/child.md')).toBe(expected);
});
it('encodes file paths as inert clipboard references for the existing asset resolver', () => {
  expect(clipboardFileReference('C:/notes/图.png')).toBe('C%3A/notes/%E5%9B%BE.png');
  expect(clipboardFileReference('//server/share/图.png')).toBe('%2F%2Fserver/share/%E5%9B%BE.png');
  expect(decodeURIComponent(clipboardFileReference('D:/notes/图#一.png'))).toBe(
    'D:/notes/图#一.png',
  );
});
