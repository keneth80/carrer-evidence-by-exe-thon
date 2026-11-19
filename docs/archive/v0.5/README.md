# Career Evidence · Claude Code Starter v0.5

작성일: 2026.11.15 · 기준: 기획 v0.2 / UI·UX v0.3 / 데이터·API v0.4

**Claude Code에서 제품 구현을 이어가기 위한 실행 가능한 기초 코드와 작업 인계 묶음입니다.** React 화면, 합성 Liner 어댑터, SQLite 초기화, 테스트, Chrome 확장 진단 골격을 제공합니다. 제품 API·영속 worker·실제 Liner·지원 접수는 다음 구현 대상입니다.

## 가장 먼저 할 일

압축을 **새 폴더**에 풀고 터미널에서 이 README가 있는 폴더로 이동하세요. 기존 프로젝트가 있다면 원본 위에 통째로 덮어쓰지 않고 `docs/CLAUDE_WORKFLOW.md`의 기존 저장소 적용 절차를 사용합니다.

### 1. 실행 환경 준비

Node **24.12 이상인 24.x**, npm 11 또는 12를 사용합니다. `.nvmrc`는 24.x입니다. nvm을 이미 사용하는 Mac에서는 다음 명령을 실행합니다.

```bash
nvm install
nvm use
npm ci
cp .env.example .env
npm run doctor
```

새 폴더의 초기 실행 예입니다. 이미 `.env`가 있으면 그대로 사용하세요. nvm이 없다면 기존 Node 관리 도구로 24.x를 준비하면 됩니다. `npm ci`는 포함된 package-lock.json을 사용하며, 전역 npm·Claude 설정을 변경하지 않습니다.

### 2. 기초 화면 확인

```bash
npm test
npm run build
npm run dev
```

브라우저에서 **http://127.0.0.1:4310**을 엽니다. 필수 원격 조건에서는 합성 공고 3개가 ‘지원 검토 / 추가 확인 / 보류’로 나뉩니다. 선호 조건으로 바꾸면 모두 검토할 수 있고, 원격 정보가 없는 사실은 그대로 남습니다. ‘판단 근거 보기’로 합성 원문을 확인합니다.

API는 127.0.0.1:4311, 웹은 127.0.0.1:4310이며 Vite proxy가 `/api`를 연결합니다. 개발 프로세스는 Ctrl+C로 종료합니다. API와 확장의 허용 origin은 이 주소로 맞췄으므로 `localhost`로 바꿔 접속하지 마세요.

### 3. Claude Code에서 첫 구현 시작

이 프로젝트 폴더에서 기존에 사용하던 Claude Code를 실행합니다.

```bash
claude
```

다음 문장을 입력하세요.

```text
CLAUDE.md와 prompts/00-start.md를 읽고 실행해줘.
기존 스타터 코드와 계약을 확인한 뒤, 세션 → context → mock 검색 작업 저장 → worker 처리 → 저장 결과 조회를 첫 제품 흐름으로 구현해줘.
관련 검증을 실행하고 docs/state/PROGRESS.md와 HANDOFF.md를 갱신해줘.
```

`CLAUDE.md`가 공통 기준을 제공하고 `prompts/00-start.md`가 첫 완료 범위를 지정합니다. Claude Code를 새로 설치하거나 로그인해야 한다면 공식 문서에서 현재 설치 방법을 확인하세요: https://code.claude.com/docs/en/quickstart . 이 킷은 모델·계정·권한 모드를 강제로 바꾸지 않습니다.

## 현재 실제로 있는 것

| 구분 | 제공 상태 | 다음 구현 |
| --- | --- | --- |
| React 웹 | 합성 공고 비교·원격 우선순위 변경·근거 보기·테스트 폼 화면 | 저장된 제품 context·task·candidate API에 연결 |
| API | `/api/health`, `/api/starter/preview` | 계약 v0.4의 `/api/v1/*` handler. 현재 501 응답 |
| SQLite | 빈 DB 초기화, FK·WAL·busy timeout, 기준 SQL·DB 객체 변경 감지 | 세션·작업·승인 저장 서비스와 명시적 migration |
| 도메인 | match.v1 일부, 원격 조건 평가, 답변 LF·500 code point 검증 | 전체 프로필·조건·출처·버전 관계 검증 |
| Liner | 결정적인 mock 어댑터와 typed interface | live 호출·SSE·출처 정규화·비용 예약. 현재 live는 오류로 종료 |
| worker | 구현할 진입점과 책임 문서 | 영속 queue·lease·heartbeat·generation CAS·복구. 현재 실행 시 exit 1 |
| Chrome 확장 | MV3 side panel, 정확한 자체 폼 표식 확인 진단 | 고정 bridge·입력·첨부·최종 승인·receipt/reconcile |

SQLite는 **제품 테이블 17개 + 스타터 metadata 테이블 1개**를 사용합니다. 기존 SQL을 바꾸거나, DB의 테이블·인덱스·트리거 정의가 바뀌면 자동 초기화 대신 오류를 반환합니다. metadata는 migration 도구나 운영 백업을 대체하지 않습니다.

## 작업 파일 안내

| 파일·경로 | 역할 |
| --- | --- |
| CLAUDE.md | 짧은 공통 지침·불변 조건·보고 방식 |
| DECISIONS.md | 기술 결정·범위·변경 이유 |
| docs/CODEMAP.md | 기능을 수정할 때 먼저 볼 코드 위치 |
| docs/state/PROGRESS.md | 구현 상태와 완료 증거 |
| docs/state/HANDOFF.md | 다음 한 작업·재현 명령·남은 문제 |
| prompts/00-start.md | 첫 실행 지시문 |
| prompts/01~06 | 기반→검색·분석→재평가·브리프→지원 서버→확장→데모 순서 |
| prompts/resume.md · review.md | 세션 재개·변경 검토 |
| contracts/v0.4/ | 원본 SQL·OpenAPI·JSON Schema·예제·테스트·설계 문서 |
| docs/reference/ | 기획·UI·데이터 API PDF 참고본 |
| docs/reports/VALIDATION.md | 이번 킷의 실제 검증 결과와 미실행 항목 |

## 환경변수

| 변수 | 기본값 | 현재 의미 |
| --- | --- | --- |
| LINER_MODE | mock | 기본 어댑터. live로 바꾸면 미구현 오류 |
| LINER_API_KEY | 빈 값 | 향후 서버 live 어댑터 전용. 현재 불필요 |
| LINER_BUDGET_MICRO_USD | 0 | 향후 비용 예약 설정. 현재 유료 호출 없음 |
| DEMO_ORIGIN | http://127.0.0.1:4310 | 웹·폼·확장의 정확한 로컬 origin |
| API_PORT | 4311 | 로컬 API port |
| DATABASE_PATH | .data/career-evidence.sqlite | API의 영속 DB 파일 |
| BROWSER_APPLY_ENABLED | false | true는 현재 미구현 오류 |

제품 실행에는 Anthropic·OpenAI API 키가 필요하지 않습니다. Claude Code는 개발 도구이며 제품의 Liner 호출과 별개입니다. `.env`, DB, 실제 이력서, node_modules는 압축·Git 대상에서 제외합니다. 키를 브라우저용 `VITE_` 변수에 넣지 않습니다.

## 계약 검증 — Miniconda

Node 앱 실행에는 Python이 필요하지 않습니다. 기존 v0.4 계약 테스트를 실행할 때만 아래 환경을 준비합니다.

```bash
conda create -n career-evidence-contracts python=3.12 -y
conda activate career-evidence-contracts
python -m pip install -r contracts/v0.4/requirements-validation.txt
npm run check:contracts
```

`check:contracts`는 기준 파일 해시, 기존 계약 테스트 61개, 새 mock 출력의 schema 정합성을 확인합니다. API 키나 외부 지원 계정을 사용하지 않습니다. 전체 로컬 검사 묶음은 `npm run check`입니다. 자동으로 Python을 설치하지 않으므로 위 환경을 먼저 준비합니다.

실제 HTTP 경계는 `npm run smoke:http`로 확인합니다. 비어 있는 port와 memory DB를 사용하므로 실행 중인 개발 서버나 DB를 변경하지 않습니다. 브라우저 화면과 Chrome 확장은 이 검사와 별도로 확인합니다.

## 재개와 사용량 관리

작업을 끝낼 때 `docs/state/HANDOFF.md`에 다음 한 작업과 검증 결과를 남깁니다. 같은 프로젝트의 최근 세션을 이어가려면 `claude -c`, 새 대화에서 필요한 정보만 이어가려면 `prompts/resume.md`를 읽도록 지시합니다. 한 번에 전체 MVP를 요청하기보다 현재 단계의 완료 기준을 충족하도록 작업합니다.

`CLAUDE.md`에는 전체 명세를 import하지 않았습니다. 코드 위치는 CODEMAP에서 찾고 현재 작업의 계약 부분만 추가로 읽습니다. 구체적인 운영 방법과 공식 출처는 `docs/CLAUDE_WORKFLOW.md`에 있습니다.

## 다음 완료 목표

기획의 11/18 기준으로 검색→비교→근거 확인이 우선입니다. 실제 Liner 품질 검증 이후 자체 폼 1종의 입력·첨부·승인·접수를 연결하고, 11/23~24에는 기능을 동결해 11/25 제출 자료를 준비합니다. 이 일정은 팀의 실행 계획이며, 킷을 생성한 것만으로 제품 단계가 완료되지는 않습니다.

