import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { readConfig } from '../apps/api/src/config.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (existsSync('.env')) loadEnvFile('.env');
const [major, minor] = process.versions.node.split('.').map(Number);
const checks = [];
checks.push({ check: 'Node 24.12+', ok: major === 24 && minor >= 12, detail: process.version });
for (const file of ['CLAUDE.md','DECISIONS.md','docs/CODEMAP.md','docs/state/PROGRESS.md','docs/state/HANDOFF.md','docs/PRODUCT_SPEC.md','docs/UI_UX.md','docs/ARCHITECTURE.md','contracts/v0.7/README.md','contracts/v0.7/openapi.yaml','contracts/v0.4/schema.sql','prompts/01-resume-search.md','package-lock.json']) {
  checks.push({ check: file, ok: existsSync(file) });
}
for (const dependency of ['typescript','react','react-dom','vite']) {
  checks.push({ check: `dependency:${dependency}`, ok: existsSync(`node_modules/${dependency}/package.json`) });
}
try { readConfig(); checks.push({ check: 'mock configuration', ok: true }); }
catch (error) { checks.push({ check: 'mock configuration', ok: false, detail: error.message }); }
const claude = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 5000 });
const packageInfo = JSON.parse(readFileSync('package.json','utf8'));
console.log(JSON.stringify({
  starter: packageInfo.version,
  checks,
  claude_cli: claude.status === 0 ? 'present; login/model not checked' : 'not verified; install/check in your development environment',
  environment: { env_file_present: existsSync('.env'), liner_api_key_present: Boolean(process.env.LINER_API_KEY), live_calls_enabled: false },
}, null, 2));
if (checks.some(check => !check.ok)) process.exitCode = 1;

