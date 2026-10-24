export interface NavigationPosition {
  noteId: string;
  path: string | null;
  cursor: number;
  scrollTop: number;
}

export interface NavigationHistory {
  entries: readonly NavigationPosition[];
  index: number;
}

export function createNavigationHistory(
  initial: NavigationPosition | null = null,
): NavigationHistory {
  return { entries: initial ? [{ ...initial }] : [], index: initial ? 0 : -1 };
}

function captureLeaving(
  history: NavigationHistory,
  leaving: NavigationPosition | null,
): NavigationHistory {
  if (!leaving) return history;
  if (history.index < 0) return createNavigationHistory(leaving);
  const entries = [...history.entries];
  entries[history.index] = { ...leaving };
  return { entries, index: history.index };
}

/** Call only for explicit navigation; typing and scrolling are captured when leaving. */
export function pushNavigation(
  history: NavigationHistory,
  leaving: NavigationPosition | null,
  target: NavigationPosition,
): NavigationHistory {
  const captured = captureLeaving(history, leaving);
  const entries = captured.entries.slice(0, captured.index + 1);
  const current = entries[captured.index];
  if (current?.noteId === target.noteId && current.cursor === target.cursor)
    entries[captured.index] = { ...target };
  else entries.push({ ...target });
  return { entries, index: entries.length - 1 };
}

export function stepNavigation(
  history: NavigationHistory,
  leaving: NavigationPosition | null,
  direction: -1 | 1,
): { history: NavigationHistory; target: NavigationPosition | null } {
  const captured = captureLeaving(history, leaving);
  const next = captured.index + direction;
  if (next < 0 || next >= captured.entries.length) return { history: captured, target: null };
  return {
    history: { entries: captured.entries, index: next },
    target: { ...captured.entries[next] },
  };
}

/** Explicitly discarded drafts cannot be reopened; closing a saved-file tab need not remove it. */
export function removeNavigationNote(
  history: NavigationHistory,
  noteId: string,
): NavigationHistory {
  const entries = history.entries.filter((entry) => entry.noteId !== noteId);
  if (entries.length === history.entries.length) return history;
  if (!entries.length) return createNavigationHistory();
  const removedBefore = history.entries
    .slice(0, history.index + 1)
    .filter((entry) => entry.noteId === noteId).length;
  return {
    entries,
    index: Math.min(entries.length - 1, Math.max(0, history.index - removedBefore)),
  };
}

export function resolveNavigationPosition(
  position: NavigationPosition,
  available: readonly { id: string; path: string | null }[],
): NavigationPosition | null {
  const live =
    available.find((note) => note.id === position.noteId) ??
    (position.path ? available.find((note) => note.path === position.path) : undefined);
  if (live) return { ...position, noteId: live.id, path: live.path };
  return position.path ? { ...position } : null;
}
