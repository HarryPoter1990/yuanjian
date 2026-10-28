import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const server = await createServer({
  configFile: false,
  plugins: [react()],
  optimizeDeps: { entries: ['src/editor/editor.prototype.html'] },
  server: {
    host: '127.0.0.1',
    port: 4192,
    strictPort: true,
    open: false,
    watch: { ignored: ['**/artifacts/**', '**/.test-data/**'] },
  },
});
await server.listen();
console.log('鸢笺编辑体验试用：http://127.0.0.1:4192/src/editor/editor.prototype.html');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await server.close();
    process.exit();
  });
