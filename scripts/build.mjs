import { build } from 'vite';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
await build({ configFile: 'apps/web/vite.config.ts' });
mkdirSync('dist', { recursive: true });
rmSync('dist/extension', { recursive: true, force: true });
cpSync('apps/extension', 'dist/extension', { recursive: true, filter: path => !path.endsWith('.test.mjs') });
writeFileSync('dist/BUILD_INFO.json', JSON.stringify({
  version: '0.5.0', frontend: 'dist/web', extension: 'dist/extension',
  api_runtime: 'Node 24.12+ runs apps/api/src/main.ts directly',
  worker: 'search_tailor_render_mock', product_api: 'partial_s01_s02_s04', deployment: 'not_performed',
}, null, 2) + '\n');
console.log('Build complete: web bundle + extension files. Deployment and product E2E are separate.');

