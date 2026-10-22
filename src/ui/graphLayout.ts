import type { Core, Layouts } from 'cytoscape';

/** Initial placement must complete even when Electron throttles animation frames. */
export function runInitialGraphLayout(graph: Core, onComplete: () => void): Layouts {
  const layout = graph.layout({
    name: 'circle',
    animate: false,
    padding: 60,
    avoidOverlap: true,
    spacingFactor: 1.8,
  });
  layout.one('layoutstop', onComplete);
  layout.run();
  return layout;
}
