import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// 통합 자료의 끊어진 진입 경로·과거 작업 지시·기준 파일 손상을 확인한다.
// 제품 사용자 흐름·브라우저 실행을 검증하는 테스트가 아니다.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const required = [
  'README.md', 'CLAUDE.md', 'DECISIONS.md',
  'docs/PRODUCT_SPEC.md', 'docs/UI_UX.md', 'docs/ARCHITECTURE.md',
  'docs/BROWSER_ADAPTERS.md', 'docs/EXTENSION_START.md', 'docs/ACCEPTANCE.md',
  'docs/IMPLEMENTATION_PLAN.md', 'docs/CLAUDE_WORKFLOW.md', 'docs/CODEMAP.md',
  'docs/state/PROGRESS.md', 'docs/state/HANDOFF.md', 'docs/reports/VALIDATION.md',
  'docs/DEMO_PLAN.md', 'docs/SOURCES.md',
  'prompts/00-start.md', 'prompts/01-resume-search.md', 'prompts/02-chat-resume.md',
  'prompts/03-browser-history.md', 'prompts/04-similar-jobs.md', 'prompts/05-auto-apply.md',
  'prompts/06-demo-quality.md', 'prompts/resume.md', 'prompts/review.md',
  'contracts/v0.7/README.md', 'contracts/v0.7/openapi.yaml',
  'contracts/v0.7/schemas/domain.schema.json', 'contracts/v0.7/migrations/007_resume_workflow.sql',
  'fixtures/resumes/README.md', 'fixtures/resumes/expected.json',
];
for (const path of required) assert.ok(existsSync(resolve(root, path)), `MISSING_ENTRY: ${path}`);
const packageInfo = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.equal(packageInfo.version, lock.version, 'package and lock version differ');
assert.equal(packageInfo.version, lock.packages[''].version, 'root lock package version differs');
assert.equal(JSON.parse(read('apps/extension/manifest.json')).version, packageInfo.version, 'extension package version differs');

const oldPrompts = ['01-foundation.md','02-search-analysis.md','03-brief-reevaluation.md','04-application-server.md','05-browser-extension.md','06-demo-release.md'];
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules','dist','.git','.data','__pycache__','.pytest_cache'].includes(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
let markdownFiles = 0, localLinks = 0;
for (const file of walk(root)) {
  const name = relative(root, file).replaceAll('\\','/');
  if (!name.endsWith('.md') || name.startsWith('docs/archive/') || name.startsWith('contracts/v0.4/')) continue;
  const body = readFileSync(file,'utf8');
  assert.ok(!body.includes('\ufffd'), `INVALID_UTF8: ${name}`);
  assert.ok(!body.includes('\u0000'), `NUL_CHARACTER: ${name}`);
  const fences = body.match(/^```/gm) ?? [];
  assert.equal(fences.length % 2, 0, `UNBALANCED_FENCE: ${name}`);
  for (const stale of oldPrompts) assert.ok(!body.includes(`prompts/${stale}`), `STALE_PROMPT: ${name} -> ${stale}`);
  for (const match of body.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = match[1].split(/\s+["']/)[0].split('#')[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    const path = resolve(dirname(file), decodeURIComponent(target));
    assert.ok(existsSync(path), `BROKEN_LINK: ${name} -> ${target}`);
    localLinks++;
  }
  markdownFiles++;
}

const baseline = resolve(root,'contracts/v0.4');
let baselineFiles = 0;
for (const line of read('contracts/v0.4/MANIFEST.sha256').trim().split('\n')) {
  const [digest, name] = line.split('  ');
  assert.equal(hash(resolve(baseline, name)), digest, `BASELINE_CHANGED: ${name}`);
  baselineFiles++;
}
const fixtures = JSON.parse(read('fixtures/resumes/expected.json'));
assert.equal(fixtures.real_person, false);
assert.equal(fixtures.cases.length, 2);
for (const item of fixtures.cases) {
  for (const kind of ['pdf','text']) {
    const file = resolve(root,'fixtures/resumes',item[kind]);
    assert.equal(hash(file), item[`${kind}_sha256`], `FIXTURE_CHANGED: ${item[kind]}`);
  }
}
assert.notDeepEqual(fixtures.cases[0].expected_role_signals, fixtures.cases[1].expected_role_signals);
console.log(JSON.stringify({
  status:'PASS', package_version:packageInfo.version, required_entries:required.length,
  markdown_files:markdownFiles, local_links:localLinks, baseline_files_verified:baselineFiles,
  synthetic_resume_inputs:fixtures.cases.length,
  scope:'integration documentation, pointers, frozen baseline and fixture bytes',
  product_workflow:'NOT_RUN', browser_submission:'NOT_RUN',
},null,2));
