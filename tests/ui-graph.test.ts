// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import cytoscape from 'cytoscape';
import { runInitialGraphLayout } from '../src/ui/graphLayout';

describe('graph initial layout', () => {
  it.each([2, 1000])('completes %i nodes without waiting for animation frames', (count) => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    const graph = cytoscape({
      headless: true,
      layout: { name: 'preset' },
      elements: Array.from({ length: count }, (_, id) => ({ data: { id: String(id) } })),
    });
    try {
      const done = vi.fn();
      const layout = runInitialGraphLayout(graph, done);
      expect(done).toHaveBeenCalledTimes(1);
      expect(frame).not.toHaveBeenCalled();
      const positions: { x: number; y: number }[] = [];
      graph.nodes().forEach((node) => {
        positions.push(node.position());
      });
      expect(
        positions.every((position) => Number.isFinite(position.x) && Number.isFinite(position.y)),
      ).toBe(true);
      layout.stop();
    } finally {
      graph.destroy();
      frame.mockRestore();
    }
  });
});
