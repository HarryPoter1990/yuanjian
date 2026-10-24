// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { loadGraphModule } from 'virtual:yuanjian-graph';
import { LazyGraphView } from '../src/components/LazyGraphView';
import { defaultSettings } from '../src/shared/defaults';
vi.mock('virtual:yuanjian-graph', () => ({ loadGraphModule: vi.fn() }));
it('recovers from a graph rendering error when the retried module resolves immediately', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const reported: unknown[][] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => reported.push(args));
  let fail = true;
  function Fixture() {
    if (fail) throw Error('generated graph render fault');
    return <div data-testid="render-recovered">图谱恢复</div>;
  }
  vi.mocked(loadGraphModule).mockResolvedValue({ GraphView: Fixture });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <LazyGraphView
          settings={defaultSettings}
          index={[]}
          activePath={null}
          onSettings={() => {}}
          onOpen={() => {}}
          onError={() => {}}
          onBack={() => {}}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    fail = false;
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((el) => el.textContent === '重试加载')!
        .click(),
    );
    expect(loadGraphModule).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="render-recovered"]')).not.toBeNull();
    expect(
      reported.some((args) =>
        args.some((value) => String(value).includes('generated graph render fault')),
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
