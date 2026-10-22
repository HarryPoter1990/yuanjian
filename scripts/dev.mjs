import { build as buildRenderer, createServer } from 'vite';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import electron from 'electron';
import path from 'node:path';

await buildRenderer({ logLevel: 'warn' });
await build({
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
});
const server = await createServer();
await server.listen();
const environment = {
  ...process.env,
  LOCAL_NOTES_TEST: '1',
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', `--data-dir=${path.resolve('.test-data/dev-profile')}`], {
  stdio: 'inherit',
  env: environment,
  windowsHide: true,
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
