import { describe, expect, it } from 'vitest';
import {
  createNavigationHistory,
  pushNavigation,
  removeNavigationNote,
  resolveNavigationPosition,
  stepNavigation,
  type NavigationPosition,
} from '../src/ui/navigationHistory';

const position = (
  noteId: string,
  cursor = 0,
  scrollTop = 0,
  file: string | null = `D:/generated/${noteId}.md`,
): NavigationPosition => ({ noteId, path: file, cursor, scrollTop });

describe('in-memory explicit note navigation history', () => {
  it('keeps an initial location and records explicit navigation between documents', () => {
    const a = position('A', 2, 10),
      b = position('B', 4, 20);
    const initial = createNavigationHistory(a);
    const next = pushNavigation(initial, a, b);
    expect(next).toEqual({ entries: [a, b], index: 1 });
    expect(initial).toEqual({ entries: [a], index: 0 });
    expect(stepNavigation(next, b, -1).target).toEqual(a);
  });
  it('records distinct cursor destinations within the same note', () => {
    const first = position('A', 0),
      heading = position('A', 50, 240);
    const history = pushNavigation(createNavigationHistory(first), first, heading);
    expect(history.entries).toEqual([first, heading]);
    expect(stepNavigation(history, heading, -1).target).toEqual(first);
  });
  it('captures the actual leaving position so forward returns to later typing and reading', () => {
    const a = position('A', 0),
      b = position('B', 10);
    const history = pushNavigation(createNavigationHistory(a), a, b);
    const laterB = position('B', 48, 600);
    const back = stepNavigation(history, laterB, -1);
    expect(back.target).toEqual(a);
    expect(back.history.entries[1]).toEqual(laterB);
    const laterA = position('A', 7, 80);
    const forward = stepNavigation(back.history, laterA, 1);
    expect(forward.target).toEqual(laterB);
    expect(forward.history.entries[0]).toEqual(laterA);
  });
  it('truncates the forward branch after a new explicit destination', () => {
    const a = position('A'),
      b = position('B'),
      c = position('C'),
      d = position('D');
    const history = pushNavigation(pushNavigation(createNavigationHistory(a), a, b), b, c);
    const back = stepNavigation(history, c, -1);
    const branched = pushNavigation(back.history, position('B', 8, 30), d);
    expect(branched.entries).toEqual([a, position('B', 8, 30), d]);
    expect(stepNavigation(branched, d, 1).target).toBeNull();
  });
  it('deduplicates the same note and cursor while refreshing its path and scroll snapshot', () => {
    const start = position('A', 10, 0);
    const target = position('A', 10, 500, 'D:/generated/moved.md');
    const next = pushNavigation(createNavigationHistory(start), start, target);
    expect(next).toEqual({ entries: [target], index: 0 });
    const edge = stepNavigation(next, { ...target, scrollTop: 800 }, -1);
    expect(edge.target).toBeNull();
    expect(edge.history.entries[0].scrollTop).toBe(800);
  });
  it('does not add another entry for a repeated explicit destination after going back', () => {
    const a = position('A'),
      b = position('B'),
      c = position('C');
    const history = pushNavigation(pushNavigation(createNavigationHistory(a), a, b), b, c);
    const back = stepNavigation(history, c, -1);
    const same = pushNavigation(back.history, b, { ...b, scrollTop: 300 });
    expect(same.entries).toEqual([a, { ...b, scrollTop: 300 }]);
    expect(same.index).toBe(1);
  });
  it('starts empty without observing input, scroll, timers or persistent state', () => {
    const empty = createNavigationHistory();
    expect(empty).toEqual({ entries: [], index: -1 });
    expect(stepNavigation(empty, null, -1)).toEqual({ history: empty, target: null });
    const first = pushNavigation(empty, null, position('A'));
    expect(first).toEqual({ entries: [position('A')], index: 0 });
    expect(empty.entries).toEqual([]);
  });
  it('preserves a closed saved-file destination, but cannot reopen an absent unnamed draft', () => {
    const saved = position('closed-file', 15, 120, 'D:/generated/reopen.md');
    expect(resolveNavigationPosition(saved, [])).toEqual(saved);
    const draft = position('discarded-draft', 8, 20, null);
    expect(resolveNavigationPosition(draft, [])).toBeNull();
  });
  it('prefers a live note id and otherwise resolves the same path to its reopened tab id', () => {
    const old = position('old-id', 15, 120, 'D:/generated/saved.md');
    expect(
      resolveNavigationPosition(old, [{ id: 'old-id', path: 'D:/generated/moved.md' }]),
    ).toEqual({
      ...old,
      path: 'D:/generated/moved.md',
    });
    expect(resolveNavigationPosition(old, [{ id: 'new-id', path: old.path }])).toEqual({
      ...old,
      noteId: 'new-id',
    });
  });
  it('forgets explicitly discarded note locations and maintains a valid adjacent history cursor', () => {
    const a = position('A'),
      draft = position('draft', 5, 0, null),
      b = position('B');
    const history = pushNavigation(pushNavigation(createNavigationHistory(a), a, draft), draft, b);
    const withoutDraft = removeNavigationNote(history, draft.noteId);
    expect(withoutDraft).toEqual({ entries: [a, b], index: 1 });
    expect(stepNavigation(withoutDraft, b, -1).target).toEqual(a);
    const onlyDraft = removeNavigationNote(createNavigationHistory(draft), draft.noteId);
    expect(onlyDraft).toEqual({ entries: [], index: -1 });
  });
  it('copies positions so later mutation of a captured object cannot rewrite prior history', () => {
    const a = position('A'),
      b = position('B');
    const history = pushNavigation(createNavigationHistory(a), a, b);
    a.cursor = 999;
    b.scrollTop = 999;
    expect(history.entries).toEqual([position('A'), position('B')]);
  });
});
it('copies JSON scroll anchors through creation, navigation, resolution and pruning', () => {
  const a = { ...position('A'), scrollAnchor: { from: 12, offset: -4, left: 9 } },
    b = { ...position('B'), scrollAnchor: { from: 22, offset: 3, left: 2 } };
  const initial = createNavigationHistory(a);
  a.scrollAnchor.from = 999;
  expect(initial.entries[0].scrollAnchor?.from).toBe(12);
  const history = pushNavigation(initial, null, b);
  b.scrollAnchor.offset = 999;
  expect(history.entries[1].scrollAnchor?.offset).toBe(3);
  initial.entries[0].scrollAnchor!.left = 999;
  expect(history.entries[0].scrollAnchor?.left).toBe(9);
  const back = stepNavigation(history, null, -1);
  back.target!.scrollAnchor!.offset = 999;
  expect(back.history.entries[0].scrollAnchor?.offset).toBe(-4);
  const resolved = resolveNavigationPosition(history.entries[1], [])!;
  resolved.scrollAnchor!.left = 999;
  expect(history.entries[1].scrollAnchor?.left).toBe(2);
  const pruned = removeNavigationNote(history, 'B');
  pruned.entries[0].scrollAnchor!.offset = 999;
  expect(history.entries[0].scrollAnchor?.offset).toBe(-4);
});
