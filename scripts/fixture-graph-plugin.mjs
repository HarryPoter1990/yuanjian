import path from 'node:path';

// Single-bundle UI fixtures exercise the real graph with their existing React instance.
// Production chunk loading/retries must be checked separately against the built renderer.
export function fixtureGraphPlugin() {
  return {
    name: 'fixture-graph-loading',
    setup(build) {
      build.onResolve({ filter: /^virtual:yuanjian-graph$/ }, () => ({
        path: 'graph',
        namespace: 'fixture-graph',
      }));
      build.onLoad({ filter: /.*/, namespace: 'fixture-graph' }, () => ({
        contents: `import {createElement} from 'react';
          import cytoscape from 'cytoscape';
          export const loadGraphModule = async () => {
            const {GraphView} = await import(${JSON.stringify(path.resolve('src/components/GraphView.tsx'))});
            return {GraphView: props => createElement(GraphView, {...props, engine: cytoscape})};
          };`,
        loader: 'js',
        resolveDir: process.cwd(),
      }));
    },
  };
}
