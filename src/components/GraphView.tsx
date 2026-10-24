import { useEffect, useRef, useState } from 'react';
import type cytoscape from 'cytoscape';
import type { Core, ElementDefinition, Layouts } from 'cytoscape';
import { Maximize, RefreshCw, Search, ZoomIn, ZoomOut } from '../ui/icons';
import type { GraphPreferences, NoteMeta, Settings } from '../shared/types';
import { appearanceColors, errorText, fileName } from '../ui/model';
import { IconButton } from './Controls';
import { runInitialGraphLayout } from '../ui/graphLayout';

export function GraphView({
  engine,
  index,
  settings,
  activePath,
  onSettings,
  onOpen,
  onError,
}: {
  engine: typeof cytoscape;
  index: NoteMeta[];
  settings: Settings;
  activePath: string | null;
  onSettings(settings: Settings): void;
  onOpen(path: string): void;
  onError(message: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const layout = useRef<Layouts | null>(null);
  const resetRequested = useRef(false);
  const current = useRef({ settings, onSettings });
  current.current = { settings, onSettings };
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(0);
  const [rebuild, setRebuild] = useState(0);
  const prefs = settings.graph;
  const colors = appearanceColors(
    settings.appearance,
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  function patch(value: Partial<GraphPreferences>) {
    onSettings({ ...settings, graph: { ...prefs, ...value } });
  }
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saveViewport: (() => void) | undefined;
    let disposeClose: (() => void) | undefined;
    setBusy(true);
    async function build() {
      const scope = prefs.root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const filtered = index.filter((note) => {
        const file = note.path.replace(/\\/g, '/').toLowerCase();
        return (
          (!scope || file.startsWith(`${scope}/`)) && (!prefs.tag || note.tags.includes(prefs.tag))
        );
      });
      const notes = new Map(filtered.map((note) => [note.path, note]));
      const edges: { source: string; target: string; attachment?: boolean }[] = [];
      for (const note of filtered) {
        for (const link of note.links) {
          if (/^(https?:|mailto:|data:)/i.test(link.target)) continue;
          if (link.image && !prefs.attachments) continue;
          const resolved = await window.notes.resolveLink(note.path, link.target);
          if (!alive) return;
          if (
            resolved.path &&
            resolved.exists &&
            (notes.has(resolved.path) || (link.image && prefs.attachments))
          )
            edges.push({ source: note.path, target: resolved.path, attachment: link.image });
        }
      }
      let included = new Set(notes.keys());
      if (prefs.local) {
        included = new Set(activePath && notes.has(activePath) ? [activePath] : []);
        for (let step = 0; step < prefs.depth; step++) {
          const next = new Set(included);
          edges.forEach((edge) => {
            if (included.has(edge.source)) next.add(edge.target);
            if (included.has(edge.target)) next.add(edge.source);
          });
          included = next;
        }
      }
      const elements: ElementDefinition[] = [];
      const nodeIds = new Set<string>();
      function node(id: string, label: string, kind: string, path?: string) {
        if (nodeIds.has(id)) return;
        nodeIds.add(id);
        elements.push({
          data: { id, label, kind, path },
          position: current.current.settings.graph.positions[id],
        });
      }
      filtered
        .filter((note) => included.has(note.path))
        .forEach((note) => {
          node(note.path, note.title, 'note', note.path);
          if (prefs.tags)
            note.tags.forEach((tag) => {
              node(`tag:${tag}`, `#${tag}`, 'tag');
              elements.push({
                data: { id: `tag:${note.path}:${tag}`, source: note.path, target: `tag:${tag}` },
              });
            });
        });
      edges
        .filter(
          (edge) =>
            included.has(edge.source) &&
            (included.has(edge.target) || (edge.attachment && prefs.attachments)),
        )
        .forEach((edge, i) => {
          if (edge.attachment) node(edge.target, fileName(edge.target), 'attachment', edge.target);
          if (nodeIds.has(edge.source) && nodeIds.has(edge.target))
            elements.push({ data: { id: `edge:${i}`, source: edge.source, target: edge.target } });
        });
      if (!alive || !container.current) return;
      const hasPositions = elements
        .filter((element) => !element.data.source)
        .every((element) => element.position);
      const instance = engine({
        container: container.current,
        elements,
        minZoom: 0.15,
        maxZoom: 4,
        layout: { name: 'preset' },
        style: [
          {
            selector: 'node',
            style: {
              label: 'data(label)',
              'font-size': 12,
              color: colors.foreground,
              'background-color': colors.accent,
              width: 13,
              height: 13,
              'text-valign': 'bottom',
              'text-margin-y': 9,
              'text-max-width': '130px',
              'text-wrap': 'ellipsis',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 1,
              'line-color': colors.accent,
              opacity: 0.25,
              'curve-style': 'bezier',
            },
          },
          {
            selector: 'node[kind="tag"]',
            style: { 'background-color': '#b49a6e', width: 9, height: 9 },
          },
          {
            selector: 'node[kind="attachment"]',
            style: {
              shape: 'round-rectangle',
              'background-color': '#8997a8',
              width: 10,
              height: 10,
            },
          },
          { selector: ':selected', style: { 'border-width': 3, 'border-color': '#c4d9cf' } },
        ],
      });
      graph.current = instance;
      if (hasPositions) {
        instance.zoom(current.current.settings.graph.zoom);
        instance.pan(current.current.settings.graph.pan);
      }
      saveViewport = () => {
        const latest = current.current;
        const positions: GraphPreferences['positions'] = { ...latest.settings.graph.positions };
        instance.nodes().forEach((item) => {
          positions[item.id()] = { ...item.position() };
        });
        latest.onSettings({
          ...latest.settings,
          graph: {
            ...latest.settings.graph,
            positions,
            zoom: instance.zoom(),
            pan: { ...instance.pan() },
          },
        });
      };
      const persist = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (alive) saveViewport?.();
        }, 300);
      };
      instance.on('dragfree zoom pan layoutstop', persist);
      instance.on('tap', 'node[kind="note"]', (event) => onOpen(String(event.target.data('path'))));
      disposeClose = window.notes.onCloseRequested(() => saveViewport?.());
      setCount(nodeIds.size);
      if (hasPositions || !nodeIds.size) {
        setBusy(false);
        persist();
      } else {
        layout.current = runInitialGraphLayout(instance, () => {
          if (alive) setBusy(false);
        });
      }
    }
    void build().catch((error) => {
      if (alive) {
        setBusy(false);
        onError(errorText(error));
      }
    });
    return () => {
      alive = false;
      disposeClose?.();
      clearTimeout(timer);
      layout.current?.stop();
      clearTimeout(timer);
      layout.current = null;
      if (!resetRequested.current) saveViewport?.();
      resetRequested.current = false;
      graph.current?.stop();
      graph.current?.destroy();
      graph.current = null;
    };
  }, [
    index,
    prefs.local,
    prefs.depth,
    prefs.tags,
    prefs.attachments,
    prefs.root,
    prefs.tag,
    activePath,
    rebuild,
    colors.accent,
    colors.foreground,
  ]);
  const tags = [...new Set(index.flatMap((note) => note.tags))];
  const matches = query.trim()
    ? index.filter((note) => note.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];
  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <select
          aria-label="图谱范围"
          value={prefs.local ? 'local' : 'global'}
          onChange={(e) => patch({ local: e.target.value === 'local' })}
        >
          <option value="global">全局关系图</option>
          <option value="local">当前笔记 · 局部图</option>
        </select>
        {prefs.local && (
          <label>
            层数{' '}
            <input
              aria-label="局部图层数"
              type="number"
              min={1}
              max={8}
              value={prefs.depth}
              onChange={(e) => patch({ depth: Math.max(1, Math.min(8, Number(e.target.value))) })}
            />
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={prefs.tags}
            onChange={(e) => patch({ tags: e.target.checked })}
          />
          标签
        </label>
        <label>
          <input
            type="checkbox"
            checked={prefs.attachments}
            onChange={(e) => patch({ attachments: e.target.checked })}
          />
          附件
        </label>
        <select
          aria-label="图谱目录筛选"
          value={prefs.root}
          onChange={(e) => patch({ root: e.target.value })}
        >
          <option value="">全部目录</option>
          {settings.roots.map((root) => (
            <option key={root} value={root}>
              {fileName(root)}
            </option>
          ))}
        </select>
        <select
          aria-label="图谱标签筛选"
          value={prefs.tag}
          onChange={(e) => patch({ tag: e.target.value })}
        >
          <option value="">全部标签</option>
          {tags.map((tag) => (
            <option key={tag}>{tag}</option>
          ))}
        </select>
      </div>
      <div className="graph-search">
        <Search size={15} />
        <input
          aria-label="搜索图谱节点"
          placeholder="搜索笔记节点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="graph-results">
            {matches.map((note) => (
              <button key={note.path} onClick={() => onOpen(note.path)}>
                {note.title}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={container} className="graph-canvas" aria-label="关系图谱画布" />
      {busy && (
        <div className="graph-message" role="status">
          正在整理笔记关系…
        </div>
      )}
      {!busy && !count && (
        <div className="graph-message">
          {prefs.local
            ? '打开一篇已添加目录中的笔记，即可查看它的关系。'
            : '添加笔记目录后，链接会在这里连成图谱。'}
        </div>
      )}
      <div className="graph-controls">
        <IconButton
          label="放大图谱"
          onClick={() => graph.current?.zoom(graph.current.zoom() * 1.2)}
        >
          <ZoomIn size={17} />
        </IconButton>
        <IconButton
          label="缩小图谱"
          onClick={() => graph.current?.zoom(graph.current.zoom() / 1.2)}
        >
          <ZoomOut size={17} />
        </IconButton>
        <IconButton label="适合窗口" onClick={() => graph.current?.fit(undefined, 60)}>
          <Maximize size={17} />
        </IconButton>
        <IconButton
          label="重置布局和视口"
          onClick={() => {
            resetRequested.current = true;
            patch({ positions: {}, zoom: 1, pan: { x: 0, y: 0 } });
            setRebuild((value) => value + 1);
          }}
        >
          <RefreshCw size={17} />
        </IconButton>
      </div>
      <p className="graph-legend">{count} 个节点 · 拖动调整位置，点击笔记打开 · 图谱不改动正文</p>
    </div>
  );
}
