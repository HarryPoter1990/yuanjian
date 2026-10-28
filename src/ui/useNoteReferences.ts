import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractLinks } from '../shared/markdown';
import type { NoteMeta, TabState } from '../shared/types';
import type { NoteResolution } from '../shared/note-syntax';
import {
  loadNoteReferences,
  notePathKey,
  referencePath,
  type NoteReferences,
  type ReferenceRoot,
} from './noteReferences';

export function useNoteReferences(
  active: TabState | null | undefined,
  tabs: readonly TabState[],
  index: readonly NoteMeta[],
) {
  const current = useRef(active);
  current.current = active;
  const openSources = useRef(new Map<string, string>());
  openSources.current = new Map(tabs.map((tab) => [notePathKey(referencePath(tab)), tab.content]));
  const getOpen = useCallback((path: string) => openSources.current.get(notePathKey(path)), []);
  const snapshot = useRef<{ root: string; context: NoteReferences } | null>(null);
  const [loadedRevision, setLoadedRevision] = useState(0);
  const signature = useMemo(
    () =>
      active
        ? JSON.stringify(
            extractLinks(active.content)
              .filter((link) => link.embedded && !link.image)
              .map((link) => link.target),
          )
        : '',
    [active?.content],
  );
  const rootPath = active ? referencePath(active) : '';
  const previousSources = useRef(new Map<string, string | undefined>()),
    openRevision = useRef(0);
  const related = new Map(
    [...(snapshot.current?.context.sources.keys() ?? [])]
      .filter((path) => notePathKey(path) !== notePathKey(rootPath))
      .map((path) => [path, getOpen(path)]),
  );
  if (
    related.size !== previousSources.current.size ||
    [...related].some(([path, source]) => previousSources.current.get(path) !== source)
  ) {
    previousSources.current = related;
    openRevision.current++;
  }
  const revision = openRevision.current;
  useEffect(() => {
    if (!active) {
      snapshot.current = null;
      return;
    }
    let alive = true;
    void loadNoteReferences(active, getOpen, (from, target) =>
      window.notes.readEmbeddedNote(from, target),
    )
      .then((context) => {
        if (!alive) return;
        snapshot.current = { root: rootPath, context };
        setLoadedRevision((value) => value + 1);
      })
      .catch((error) => {
        if (!alive) return;
        snapshot.current = {
          root: rootPath,
          context: {
            sources: new Map(),
            resolveNote: () => ({
              error: `引用解析失败：${error instanceof Error ? error.message : String(error)}`,
            }),
          },
        };
        setLoadedRevision((value) => value + 1);
      });
    return () => {
      alive = false;
    };
  }, [active?.id, rootPath, signature, index, revision, getOpen]);

  const resolveNote = useCallback(
    (reference: string, from?: string): NoteResolution => {
      const root = current.current;
      if (!root) return { error: '没有打开的笔记' };
      const rootPath = referencePath(root),
        origin = from ?? rootPath;
      if (!reference || notePathKey(reference) === notePathKey(origin)) {
        const source = getOpen(origin);
        if (source !== undefined) return { path: origin, source };
      }
      if (snapshot.current?.root !== rootPath) return { error: `正在加载引用：${reference}` };
      return snapshot.current.context.resolveNote(reference, origin);
    },
    [getOpen],
  );
  const prepare = useCallback(async (note: ReferenceRoot) => {
    const sources = new Map(openSources.current);
    sources.set(notePathKey(referencePath(note)), note.content);
    return loadNoteReferences(
      note,
      (path) => sources.get(notePathKey(path)),
      (from, target) => window.notes.readEmbeddedNote(from, target),
    );
  }, []);
  return { resolveNote, revision: loadedRevision + revision, notePath: rootPath, prepare };
}
