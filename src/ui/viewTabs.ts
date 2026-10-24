import type { TabState, ViewTab } from '../shared/types';

export const viewKey = (view: ViewTab) => (view.kind === 'graph' ? 'graph' : `note:${view.id}`);
export const tabLabelId = (id: string) => `document-tab-note-${encodeURIComponent(id)}`;

export function reconcileViews(
  order: readonly ViewTab[] | undefined,
  tabs: readonly TabState[],
): ViewTab[] {
  const open = new Set(tabs.map((tab) => tab.id));
  const seen = new Set<string>();
  return [...(order || []), ...tabs.map((tab): ViewTab => ({ kind: 'note', id: tab.id }))].filter(
    (view) => {
      const key = viewKey(view);
      if (seen.has(key) || (view.kind === 'note' && !open.has(view.id))) return false;
      seen.add(key);
      return true;
    },
  );
}

export function insertView(
  order: readonly ViewTab[],
  view: ViewTab,
  active: string | null,
): ViewTab[] {
  const without = order.filter((item) => viewKey(item) !== viewKey(view));
  const index = without.findIndex((item) => viewKey(item) === active);
  const at = index < 0 ? without.length : index + 1;
  return [...without.slice(0, at), view, ...without.slice(at)];
}
