import { build } from 'esbuild';
await build({ entryPoints: { main: 'electron/main/index.ts', preload: 'electron/preload/index.ts' }, bundle: true, platform: 'node', target: 'node22', format: 'cjs', outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, external: ['electron', 'ffmpeg-static'] });
