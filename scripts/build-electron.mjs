import { build } from 'esbuild';
await import('./make-icon.mjs');
await build({ entryPoints: { main: 'apps/electron/main.ts', preload: 'apps/electron/preload.ts' }, bundle: true, platform: 'node', target: 'node22', format: 'cjs', outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, external: ['electron'], sourcemap: true });
