import { expect, it, vi } from 'vitest';
import { loadNoteReferences } from '../src/ui/noteReferences';

it('loads reachable sections, uses current unsaved sources and avoids unrelated references', async () => {
  const opened = new Map([
    ['C:\\notes\\child.md', '# A\n\n未保存的新内容\n\n# B\n\n![[private.md]]'],
  ]);
  const read = vi.fn(async () => ({ path: 'C:\\notes\\child.md', source: '# A\n\n磁盘旧内容' }));
  const snapshot = await loadNoteReferences(
    { id: 'root', path: 'C:\\notes\\root.md', content: '![[child#A]]' },
    (path) => opened.get(path),
    read,
  );
  expect(read).toHaveBeenCalledTimes(1);
  expect(snapshot.resolveNote('child')).toEqual({
    path: 'C:\\notes\\child.md',
    source: opened.get('C:\\notes\\child.md'),
  });
});
it('keeps failures alongside successful references and catches read exceptions', async () => {
  const read = vi.fn(async (_from: string, target: string) => {
    if (target === 'bad') throw Error('未授权');
    return { path: '/ok.md', source: '正常' };
  });
  const snapshot = await loadNoteReferences(
    { id: 'r', path: '/root.md', content: '![[bad]]\n\n![[ok]]' },
    () => undefined,
    read,
  );
  expect(snapshot.resolveNote('bad')).toEqual({ error: expect.stringContaining('未授权') });
  expect(snapshot.resolveNote('ok')).toEqual({ path: '/ok.md', source: '正常' });
});
it('bounds recursive loading and resolves same-file draft blocks without disk reads', async () => {
  const read = vi.fn(async () => ({ path: '/child.md', source: '![[child]]' }));
  const snapshot = await loadNoteReferences(
    { id: 'r', path: '/root.md', content: '![[child]]' },
    () => undefined,
    read,
  );
  expect(read.mock.calls.length).toBeLessThanOrEqual(2);
  const draft = await loadNoteReferences(
    { id: 'draft', path: null, content: '定义 ^one\n\n![[#^one]]' },
    () => undefined,
    read,
  );
  expect(draft.resolveNote('')).toEqual({ path: 'draft:draft', source: '定义 ^one\n\n![[#^one]]' });
  expect(read.mock.calls.length).toBeLessThanOrEqual(2);
});
it('does not reread a file for multiple fragments of the same reference', async () => {
  const read = vi.fn(async () => ({ path: '/child.md', source: '# A\n\n甲\n\n# B\n\n乙' }));
  await loadNoteReferences(
    { id: 'r', path: '/root.md', content: '![[child#A]]\n\n![[child#B]]' },
    () => undefined,
    read,
  );
  expect(read).toHaveBeenCalledTimes(1);
});
