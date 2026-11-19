# Career Evidence 결정 기록 — Claude Starter v0.5

2026.11.15. 기존 제품 결정은 `contracts/v0.4/DECISIONS.md`에 보존한다. 이 파일은 구현 시작점의 추가 결정을 기록하며, 제품 계약을 덮어쓰지 않는다.

| ID | 결정 | 이유·한계 |
| --- | --- | --- |
| S01 | 개발 도구는 Claude Code | 사용자 선택. Codex CLI·OpenAI SDK·Anthropic API SDK를 프로젝트 의존성으로 요구하지 않는다. |
| S02 | React·TypeScript·Node·SQLite 유지 | 기획 v0.2 및 계약 v0.4의 기반을 이어간다. 새 프레임워크 이관을 추가하지 않는다. 기존 코드가 있으면 해당 기반을 먼저 확인한다. |
| S03 | Node 24.12+ / 24.x | 안정화된 type stripping으로 서버 TS를 직접 실행하고 node:sqlite를 사용한다. tsc로 별도 형식 검사를 한다. JSX는 Vite에서 빌드한다. |
| S04 | npm + 정확한 버전 + package-lock | 새 패키지 관리 도구 없이 재현 가능한 설치. 기본 설치는 npm ci다. 버전 변경 시 관련 build/test를 함께 확인한다. |
| S05 | native HTTP는 foundation 범위 | 현재 health·fixture preview만 처리한다. 제품 handler에서 입력 schema·보안·세션·idempotency·오류 형식을 구현해야 한다. |
| S06 | fixture preview는 별도 /api/starter namespace | 즉시 실행할 화면과 실제 제품 계약의 구현 상태를 구분한다. fixture 요청은 task를 저장하지 않는다. |
| S07 | mock 기본, live와 worker는 명시적 미구현 | 키 없이 시작한다. 유료 호출·빈 worker polling·성공으로 위장한 제품 API를 만들지 않는다. |
| S08 | DB baseline을 자동 덮어쓰지 않음 | 제품 17테이블 + _starter_schema metadata 1개. SQL 파일 hash와 실제 DB 객체 정의 hash를 비교한다. 변경 시 명시적 migration이 필요하다. |
| S09 | 웹 4310 / API 4311 / 정확한 127.0.0.1 | Vite proxy로 브라우저는 같은 origin을 사용한다. localhost·port 변경은 확장/웹/API를 함께 바꾼다. |
| S10 | Chrome 진단부터 제공 | activeTab/scripting/sidePanel만 요청한다. storage·임의 URL·외부 기업 제출 기능은 현재 구현하지 않는다. |
| S11 | 짧은 CLAUDE.md + CODEMAP + 상태 파일 | 전체 명세 반복 읽기를 줄이고 재개 시 현재 구현을 찾기 쉽도록 한다. custom skill·추가 MCP·모델 강제 설정은 기본 구성에 없다. |
| S12 | Claude 첫 과업은 영속 mock 검색 흐름 | 세션→context→task 저장→worker→저장 결과 조회를 구현·검증한다. 이후 분석·근거·live 검증으로 확장한다. |

## 버전과 구현 원칙

- 현재 기준 계약은 `contracts/v0.4/`이며 SHA-256으로 원본 보존을 검사한다.
- 계약의 의미가 바뀌면 새 버전·명시적 migration·타입·예제·테스트를 함께 갱신한다. v0.4 원본 테스트를 삭제해 통과시키지 않는다.
- 프로젝트 로컬의 가역적 수정·검증을 이어간다. 기존 사용자 작업과 다른 프로젝트의 설정은 보존한다.
- 모델은 사용자의 Claude Code 환경에서 선택한다. 스타터가 요금제·계정·권한 우회 옵션을 설정하지 않는다.
- 실제 Liner 품질·비용·운영 안전성, 실제 Chrome 권한 동작, 기업 접수는 이번 foundation 검증과 구분한다.

## 구현 중 발견해 반영한 보완

1. 초기 DB 검사가 파일 hash와 테이블 수만 비교하면 보호 트리거 삭제를 놓친다. 테이블·인덱스·트리거·view 정의 digest를 추가하고 삭제 재현을 회귀 테스트에 포함했다.
2. 웹에서 조건을 바꿀 때 이전 요청을 abort하고 성공 콜백에서도 중단 여부·조건 식별자를 확인한다. 제품 API 연결 시 context/task ID 결속을 더한다.
3. CSS side-effect import의 TypeScript 선언을 추가하여 형식 검사와 Vite build를 일치시켰다.

## 공식 참고

- Claude 프로젝트 지침: https://code.claude.com/docs/en/memory
- Claude 작업 운영: https://code.claude.com/docs/en/best-practices
- Node 24 TypeScript: https://nodejs.org/docs/latest-v24.x/api/typescript.html
- Node 24 SQLite: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- Vite: https://vite.dev/guide/
- Liner·Chrome 계약 출처: `contracts/v0.4/LINER_ADAPTER.md`, `EXTENSION_PROTOCOL.md`

