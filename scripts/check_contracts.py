"""v0.4 원본·mock 정합성과 v0.7 설계 계약을 검사한다. 제품 실행 검증과 구분한다."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / 'contracts' / 'v0.4'
for line in (CONTRACTS / 'MANIFEST.sha256').read_text().splitlines():
    digest, relative = line.split('  ', 1)
    path = CONTRACTS / relative
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit(f'BASELINE_CHANGED: {relative}')

result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v'], cwd=CONTRACTS)
if result.returncode:
    raise SystemExit(result.returncode)

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
schema = json.loads((CONTRACTS / 'schemas' / 'domain.schema.json').read_text())
registry = Registry().with_resource(schema['$id'], Resource.from_contents(schema))
code = "import {buildPreview} from './apps/api/src/preview.ts'; console.log(JSON.stringify(await buildPreview('required')));"
output = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, capture_output=True, text=True, check=True)
preview = json.loads(output.stdout)
count = 0
for item in preview['items']:
    for definition, value in [('Candidate', item['candidate']), ('FactBundle', item['facts'])]:
        validator = Draft202012Validator({'$ref': schema['$id'] + '#/$defs/' + definition}, registry=registry, format_checker=FormatChecker())
        validator.validate(value)
        count += 1
    for evaluation in item['assessment']['evaluations']:
        Draft202012Validator({'$ref': schema['$id'] + '#/$defs/ConditionEvaluation'}, registry=registry, format_checker=FormatChecker()).validate(evaluation)
        count += 1
print(f'Baseline SHA-256 PASS; generated mock contract objects PASS: {count}')


# v0.7의 새 계약은 설계·구조 검증이며 API handler 구현을 의미하지 않는다.
result = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"], cwd=ROOT / "contracts" / "v0.7")
if result.returncode:
    raise SystemExit(result.returncode)
print("v0.7 contract design checks PASS; S01-S02 (mock search), S04 (mock chat, PDF) and S05 (self-test form apply) and S06 (similar-job recommend/prepare, no submission) runtime is implemented, S03 Liner live search and S4-14 Liner chat/AI review are implemented (real calls verified separately, see PROGRESS; this check uses mock only), S07 policy submission remains NOT_IMPLEMENTED")

# S01·S02·S04·S05·S06 실제 HTTP 응답(임시 DB·합성 fixture·mock 검색·mock 대화·실제 PDF 렌더·자체 테스트 폼 지원)을 v0.7 schema로 검증한다. 다른 단계의 handler 구현 검증이 아니다.
schema7 = json.loads((ROOT / 'contracts' / 'v0.7' / 'schemas' / 'domain.schema.json').read_text())
registry7 = Registry().with_resource(schema7['$id'], Resource.from_contents(schema7))
output = subprocess.run(['node', 'scripts/s01-contract-sample.mjs'], cwd=ROOT, capture_output=True, text=True, check=True)
samples = json.loads(output.stdout)
for definition, value in samples:
    Draft202012Validator({'$ref': schema7['$id'] + '#/$defs/' + definition}, registry=registry7, format_checker=FormatChecker()).validate(value)
print(f'S01-S02-S04-S05-S06 runtime responses match v0.7 schema: {len(samples)} samples')
