import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';

export default defineConfig(({ command }) => {
  const nonce = command === 'serve' ? randomBytes(18).toString('base64') : undefined;
  return {
    base: './',
    html: { cspNonce: nonce },
    plugins: [
      react(),
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
