# Career Evidence — 개발 운영 안내(이전 README, v0.9)

기준일: **2026-11-17 · 한국 시간**. 개발자가 제품의 전체 기술 구현과 통합을 맡는다. 협업자의 검수·자료·데모 참여는 선택이며 개발 진행의 선행 조건이 아니다.

**이 ZIP 하나로 새 개발을 시작할 수 있다.** 제품 명세·API·기초 코드는 v0.7을 유지하고, 시작 지침과 작업 운영을 v0.9로 바꿨다. 이번 자료 업데이트는 실제 사용자 제품 기능을 새로 구현한 것이 아니다. 사용자 PC에서 이미 진행한 변경은 이 사본에 포함되어 있지 않다.

## 1. 지금 시작하는 방법

### 아직 개발을 시작하지 않았다면

새 폴더에 압축을 풀고 이 README·CLAUDE.md·package.json이 있는 폴더를 연다. 기존 기준은 Node **24.12 이상인 24.x**, npm **11 또는 12**다. 이미 준비한 환경을 사용하고 불필요한 의존성 업그레이드는 하지 않는다.

```bash
npm ci
npm run doctor
npm test
npm run build
claude
```

Claude Code에서 다음 요청을 입력한다.

```text
CLAUDE.md와 prompts/solo-start.md를 읽고 실행해줘.
개발자가 화면·API·DB·worker·AI 편집·PDF·브라우저 실행을 전부 구현하는 방식이야.
기존 사용자 변경을 보존하고 현재 코드부터 확인해줘.
협업자 담당 API나 협업자 검수를 기다리지 말고, 이번에는 S01 이력서 등록·추출·내용 확인·확정 경력 저장까지 구현하고 관련 검증을 진행해줘.
S01만 끝났다고 검색까지 완료됐다고 표시하지 말아줘.
결과와 다음 한 작업을 PROGRESS와 HANDOFF에 기록해줘.
```

실행 기반을 눈으로 확인하려면 `npm run dev`를 실행하고 **http://127.0.0.1:4310**을 연다. API는 **http://127.0.0.1:4311**이다. 지금 보이는 화면은 합성 미리보기이며 이력서 중심 새 흐름은 구현 대상이다. 처음에는 mock을 사용하므로 Liner 키 없이 로컬 개발을 시작할 수 있다.

### v0.8에서 이미 코드를 수정했다면

**기존 프로젝트 전체를 새 ZIP으로 덮어쓰지 않는다.** 새 ZIP을 다른 폴더에 풀어 비교 자료로 두고, 현재 프로젝트에서 Claude Code에 아래 요청을 준다. 새 폴더의 실제 경로는 사용자가 붙여 넣는다.

```text
현재 프로젝트를 계속 개발할 거야. 내가 전체 개발을 맡기로 했어.
현재 Git 상태와 사용자 변경을 먼저 확인하고 보존해줘.
새 v0.9 폴더의 CLAUDE.md, DECISIONS.md의 SD 결정, docs/SOLO_DEVELOPMENT.md, prompts/solo-start.md를 참고해 운영 지침만 필요한 부분부터 병합해줘.
기존 앱·DB·의존성·.env와 구현 결과를 새 패키지의 기초 코드로 되돌리지 말아줘.
협업자 담당·필수 2인 검토 전제를 제거하고, 실제 구현 상태에서 다음 미완료 작업을 이어가줘.
```

## 2. 먼저 만들 결과와 전체 순서

| 작업 | 완성할 사용자 동작 | 기준 |
| --- | --- | --- |
| S01 | 텍스트 PDF/텍스트 등록 → 추출 비교 → 수정·확정 → 저장 | 실제 입력·소유권·재시작 후 재열람 |
| S02 | 확정 경력 → 검색 계획 → 영속 mock 작업 → 공고 표시 | 경력이 다르면 검색 계획도 달라짐 |
| S03 | Liner 실제 검색 연결 | 실제 호출·출처·오류·예산 근거를 mock과 구분 |
| S04 | 공고 선택 → AI 대화 → 변경 비교 → 제출 PDF | 확인한 사실과 실제 문서/파일 일치 |
| S05 | Chrome 자체 폼 지원 → 접수 근거 → 당시 제출본 이력 | 정확한 파일과 공고에 지원, 접수 불명 보존 |
| S06 | 고정 기준의 유사 공고 → 지원서 자동 준비 | 조건·중복 확인, 준비만 할 때 제출 없음 |
| S07 | 조건부 자동 지원 → 중지·예외 처리 | 정책 내 실행, 공고별 권한, 중복 방지 |
| S08 | 새 환경 재현 → 실제 구현 범위에 맞는 데모·제출 자료 | 기존/신규·mock/live·미완료 구분 |
| S09 | 실제 사이트·운영 조건 검증 | 실제 기업 지원 제공 전 별도 완료 필요 |

S01과 S02가 연결되어야 기존 제품 단계 1의 전체 완료 기준을 확인할 수 있다. S03의 키·계정·예산이 미준비여도 가능한 로컬 구현은 계속한다. 사용자가 이미 허용한 범위의 작업에 반복 승인을 요구하지 않는다. 세부 순서와 완료 기준은 `docs/SOLO_DEVELOPMENT.md`, 현재 업무는 `docs/solo/TASKBOARD.md`와 `tasks.json`을 따른다.

## 3. 1인 운영 방식

- 기술 구현·DB·API·화면·확장·검증의 책임자는 개발자이다. Claude Code는 이를 돕는 개발 도구다.
- 기본은 코드를 수정하는 Claude Code 세션 하나다. 별도 검토가 필요하면 읽기 위주로 운영한다. 병렬 세션이 사용량이나 시간을 줄여 준다고 전제하지 않는다.
- 화면만 또는 서버만 전부 만든 뒤 마지막에 연결하지 않는다. 위 작업 하나마다 화면·API·DB·오류 상태를 연결해 확인한다.
- 자체 검증의 실행 근거로 완료 판정할 수 있다. 협업자 확인은 선택이며 AI 검토를 사람 검수나 실제 브라우저 실행으로 기록하지 않는다.
- 자동 지원은 제품 범위에 유지한다. 초기에는 한 PDF 양식·Chrome 한 실행 채널·자체 폼 한 종류에 집중하고, Ego·DOCX/OCR·여러 사이트는 순서대로 확장한다.
- 11/25 마감·5분 이내 영상·1~2페이지 기획서는 이전 제공 안내 기준이다. 최신 안내와 사용 가능한 시간을 확인하기 전에는 확정 일정으로 사용하지 않는다.

## 4. 매번 읽을 자료

| 용도 | 파일 |
| --- | --- |
| 1인 시작·운영 | `CLAUDE.md`, `docs/SOLO_DEVELOPMENT.md`, `prompts/solo-start.md` |
| 결정·현재 상태 | `DECISIONS.md`, `docs/state/PROGRESS.md`, `docs/state/HANDOFF.md` |
| 기능별 위치 | `docs/CODEMAP.md` |
| 제품·화면·구조 | `docs/PRODUCT_SPEC.md`, `docs/UI_UX.md`, `docs/ARCHITECTURE.md` |
| 데이터·API | `contracts/v0.7/README.md` |
| 이후 구현 | `prompts/01-resume-search.md`부터 `06-demo-quality.md` |
| 검증 범위 | `docs/ACCEPTANCE.md`, `docs/reports/SOLO_PACKAGE_VALIDATION_v0.9.md` |

과거 v0.8 팀 자료는 `docs/archive/v0.8-team/`에 보존한다. 그 업무표의 역할 배정·검토자 필수 완료 규칙은 현재 개발 기준이 아니다. 제품·API는 v0.7, 현재 운영은 v0.9다. 기존 제품 요구를 다시 처음부터 설계할 필요는 없다.

## 5. 다음 세션과 검증

```text
prompts/resume.md를 읽고 현재 코드·HANDOFF에서 다음 미완료 작업을 구현·검증해줘.
전체 개발 담당은 개발자이며, 이미 완료한 부분은 다시 만들지 말아줘.
```

관련 변경에 맞춰 `npm run typecheck`, `npm test`, 필요한 `npm run build`, `npm run db:check`, `npm run smoke:http`, `npm run check:contracts`, `npm run check:integration`을 실행한다. 전체 검사만 반복하며 실제 기능 연결을 미루지 않는다. 새 기능의 실행 증거와 기존 기반 검사의 통과를 구분한다.

계약 검사에 Python이 필요하면 기존 Miniconda 환경을 사용하거나 다음처럼 준비한다. Node 앱 실행만으로는 Python이 필요하지 않다.

```bash
conda create -n career-evidence-contracts python=3.12 -y
conda activate career-evidence-contracts
python -m pip install -r contracts/v0.4/requirements-validation.txt
```

Claude Code 개발 계정은 제품 사용자용 편집 모델/API 또는 Liner 계정과 별도다. 기본 mock 개발 이후 실제 연결 단계에서 제공자·키·비용을 확인한다. 비밀 값·실제 이력서를 공개 fixture·로그·커밋에 넣지 않는다. DB 파일 삭제·초기화로 migration 문제를 숨기지 않는다.
