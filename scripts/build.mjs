import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/client.js'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives'],
  sourcemap: true,
  write: false,
  loader: { '.css': 'text' },
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-web-low-motion",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
});
for (const file of result.outputFiles) {
  if (process.argv.includes('--check')) {
    if (await readFile(file.path, 'utf8') !== file.text) throw new Error('Stale build: run pnpm build');
  } else {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
}
console.log(process.argv.includes('--check') ? 'Client and source map match source' : 'Built client and source map');
