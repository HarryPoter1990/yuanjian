import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from 'react';
import { loadGraphModule } from 'virtual:yuanjian-graph';
import type { GraphView } from './GraphView';
import { errorText } from '../ui/model';
import { LoaderCircle } from '../ui/icons';

type Renderer = ComponentType<Omit<ComponentProps<typeof GraphView>, 'engine'>>;
let ready: Renderer | null = null;
let pending: Promise<Renderer> | null = null;
let attempt = 0;
function graphModule(retry: boolean): Promise<Renderer> {
  if (retry) ready = null;
  if (ready) return Promise.resolve(ready);
  if (!pending)
    pending = loadGraphModule(attempt++)
      .then((module) => {
        if (typeof module.GraphView !== 'function') throw Error('图谱模块缺少可用的视图导出。');
        ready = module.GraphView;
        return ready;
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}
class GraphBoundary extends Component<
  { children: ReactNode; failure(reason: unknown): ReactNode },
  { failed: boolean; reason: unknown }
> {
  state: { failed: boolean; reason: unknown } = { failed: false, reason: null };
  static getDerivedStateFromError(reason: unknown) {
    return { failed: true, reason };
  }
  render() {
    return this.state.failed ? this.props.failure(this.state.reason) : this.props.children;
  }
}
export function LazyGraphView({ onBack, ...props }: ComponentProps<Renderer> & { onBack(): void }) {
  const [Renderer, setRenderer] = useState<Renderer | null>(() => ready);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback((retry = false) => {
    const request = ++generation.current;
    setFailure(null);
    if (retry) setRenderer(null);
    void graphModule(retry)
      .then((component) => {
        if (request === generation.current) setRenderer(() => component);
      })
      .catch((error) => {
        if (request === generation.current) setFailure(errorText(error));
      });
  }, []);
  useEffect(() => {
    if (!Renderer) load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const failed = (reason: unknown) => (
    <div className="graph-load-state">
      <p role="alert">图谱暂时未能打开，笔记内容仍保留。</p>
      <details>
        <summary>查看错误详情</summary>
        <pre>{errorText(reason)}</pre>
      </details>
      <div>
        <button onClick={() => load(true)}>重试加载</button>
        <button onClick={onBack}>返回笔记</button>
      </div>
    </div>
  );
  if (failure !== null) return failed(failure);
  if (!Renderer)
    return (
      <div className="graph-load-state">
        <p role="status">
          <LoaderCircle size={18} className="spin" />
          正在打开图谱…
        </p>
        <button onClick={onBack}>返回笔记</button>
      </div>
    );
  return (
    <GraphBoundary failure={failed}>
      <Renderer {...props} />
    </GraphBoundary>
  );
}
