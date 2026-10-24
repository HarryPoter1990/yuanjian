import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

export default defineConfig(({ command }) => {
  const nonce = command === 'serve' ? randomBytes(18).toString('base64') : undefined;
  return {
    base: './',
    html: { cspNonce: nonce },
    plugins: [
      react(),
      {
        name: 'yuanjian-graph-module',
        resolveId(id) {
          if (id === 'virtual:yuanjian-graph') return `\0${id}`;
        },
        async load(id) {
          if (id !== '\0virtual:yuanjian-graph') return;
          const graphUrl =
            command === 'build'
              ? `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: 'chunk', id: path.resolve('src/components/GraphView.tsx'), name: 'yuanjian-graph', preserveSignature: 'strict' })}`
              : "new URL('/src/components/GraphView.tsx', location.href).href";
          // Keep the engine self-contained: a failed shared ESM child is cached by browsers
          // even when its parent URL changes. The installed upstream ESM file has no imports.
          const enginePath = path.join(
            path.dirname(createRequire(import.meta.url).resolve('cytoscape')),
            'cytoscape.esm.min.mjs',
          );
          const engineUrl =
            command === 'build'
              ? `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: 'asset', name: 'yuanjian-graph-engine.mjs', source: await readFile(enginePath) })}`
              : "new URL('/node_modules/cytoscape/dist/cytoscape.esm.min.mjs', location.href).href";
          return `import {createElement} from 'react';
            let graph, engine;
            const load = (url, attempt) => {
              const target = new URL(url, import.meta.url);
              if (attempt) target.searchParams.set('retry', String(attempt));
              return import(/* @vite-ignore */ target.href);
            };
            export async function loadGraphModule(attempt=0) {
              await Promise.all([
                graph ? null : load(${graphUrl}, attempt).then(value => {graph=value;}),
                engine ? null : load(${engineUrl}, attempt).then(value => {engine=value;})
              ]);
              return {GraphView: props => createElement(graph.GraphView, {...props, engine:engine.default})};
            }`;
        },
      },
      {
        name: 'development-csp',
        transformIndexHtml: {
          order: 'post',
          handler: (html) =>
            nonce ? html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`) : html,
        },
      },
    ],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { chunkSizeWarningLimit: 1800 },
    test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], environment: 'node' },
  };
});
