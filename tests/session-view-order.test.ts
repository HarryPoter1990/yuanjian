import { describe, expect, it } from 'vitest';
import { sessionSchema } from '../electron/validation';

describe('session view order boundary', () => {
  it('retains mixed note/graph order separately from note contents', () => {
    const session = {
      tabs: [],
      activeId: null,
      viewOrder: [{ kind: 'graph' }, { kind: 'note', id: 'D:\\中文 笔记.md' }],
      graphActive: true,
    };
    expect(sessionSchema.parse(session)).toEqual(session);
  });
  it('continues to accept old sessions without view metadata', () => {
    expect(sessionSchema.parse({ tabs: [], activeId: null })).toEqual({ tabs: [], activeId: null });
  });
  it('rejects malformed view identities, kinds and unbounded order arrays', () => {
    for (const viewOrder of [
      [{ kind: 'note' }],
      [{ kind: 'note', id: '' }],
      [{ kind: 'browser', id: 'https://example.com' }],
      [{ kind: 'graph', id: 'forged' }],
      Array.from({ length: 202 }, () => ({ kind: 'graph' })),
    ])
      expect(sessionSchema.safeParse({ tabs: [], activeId: null, viewOrder }).success).toBe(false);
    expect(sessionSchema.safeParse({ tabs: [], activeId: null, graphActive: 'yes' }).success).toBe(
      false,
    );
  });
});
