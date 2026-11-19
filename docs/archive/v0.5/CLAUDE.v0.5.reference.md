# Career Evidence — Claude Code 프로젝트 지침

## 목표와 범위

- 구직자가 공고의 근거를 확인하고 지원 여부를 결정하는 웹·브라우저 지원 도구다.
- 기준은 기획 v0.2, UI·UX v0.3, `contracts/v0.4/`의 데이터·API 계약이다.
- 구현 기반은 React·TypeScript, 영속 Node·TypeScript 서비스/worker, SQLite다.
- 검색 → 비교 → 근거 확인을 먼저 완성한다. 브라우저 지원은 자체 테스트 폼 1종과 합성 자료로 구현한다.
- 기본 provider는 mock이다. 실제 Liner 호출은 live 설정·키·예산이 갖춰진 경로에서만 실행한다.
- 한국어로 설명하고, 구현 내용·실행한 검증·미확인 항목을 구분한다.

## 시작할 때

1. `docs/state/PROGRESS.md`, `docs/state/HANDOFF.md`, `docs/CODEMAP.md`를 읽는다.
2. 현재 요청에 해당하는 `prompts/` 파일과 계약 문서만 추가로 읽는다.
3. `git status`와 관련 코드부터 확인한다. Git 저장소가 아니면 상태를 기록하고 작업을 이어간다.
4. 기존 코드·사용자 변경을 보존한다. 이미 충족한 단계를 처음부터 다시 작성하지 않는다.
5. 짧게 작업 범위를 정한 뒤 로컬 구현·관련 검증까지 수행한다. 계획만 작성하고 끝내지 않는다.

## 주요 명령

| 명령 | 목적 |
| --- | --- |
| `npm run doctor` | Node·파일·환경 준비 상태 확인 |
| `npm run typecheck` | TypeScript 형식 검사 |
| `npm test` | 구현된 코드의 테스트 |
| `npm run build` | 배포용 빌드 가능 여부 확인 |
| `npm run dev` | 로컬 개발 실행 |
| `npm run db:check` | SQLite 계약 적용 확인 |
| `npm run check:contracts` | v0.4 계약 검증 |

실제 명령과 실행 조건은 `package.json`과 README를 확인한다. 실패를 숨기는 fallback으로 성공 처리하지 않는다.

## 계약을 읽는 순서

- 공개 JSON 형식: `contracts/v0.4/schemas/domain.schema.json`
- HTTP 경로·상태 코드: `contracts/v0.4/openapi.yaml`
- DB 제약·삽입 순서: `contracts/v0.4/schema.sql`, `DB_MAPPING.md`
- Liner: `contracts/v0.4/LINER_ADAPTER.md`
- Chrome: `contracts/v0.4/EXTENSION_PROTOCOL.md`
- 결정 이유와 변경 기록: 루트 `DECISIONS.md`

`contracts/v0.4/`는 보존하는 기준 사본이다. 계약 변경이 필요하면 새 버전과 migration을 만들고, 변경 이유·영향 범위·새 검증을 DECISIONS.md에 기록한다. 관련 타입·API·DB·예제의 의미를 함께 맞춘다.

## 제품에서 지킬 불변 조건

- 검색 회차당 후보 최대 10개, 분석 요청당 서로 다른 후보 1~3개, 심층 조사회사 1곳이다.
- 출처·사실·판단을 분리한다. 미확인을 조건 미충족이나 경력 없음으로 바꾸지 않는다.
- context·사실·평가·지원 revision은 고정 버전으로 연결한다. 늦은 결과가 최신 화면을 덮지 않는다.
- 조건 변경은 저장 근거의 재평가다. 사용자가 새 탐색을 선택하지 않았다면 재검색하지 않는다.
- provider 전송 여부가 불명확하면 유료 호출을 자동 재시도하지 않는다.
- worker의 저장 권한은 lease owner·generation·만료를 함께 검증한다. 네트워크 호출은 DB 트랜잭션 밖에서 한다.
- 승인에는 회사·직무·프로필·폼·답변·동의·파일 실제 bytes hash가 포함된다.
- 초안 변경은 이전 승인을 무효화한다. stale revision·교차 workspace·교차 application을 거절한다.
- 접수 성공은 receipt로 확인한다. 네트워크 오류를 미접수 확정으로 표시하지 않는다.
- 자동 복구는 조회다. 명시적 reconcile과 제출은 동일 DB 쓰기 제약을 따르고, 종료된 시도는 다시 접수하지 않는다.
- 확장에는 쿠키·CSRF·Liner 키를 보내지 않는다. 고정 page bridge 동작과 정확한 origin·탭·document를 확인한다.

## 구현·검증 방식

- 한 번에 검증 가능한 작은 사용자 흐름을 구현한다. 관련 코드부터 `rg`로 찾는다.
- mock 결과는 화면·응답·기록에서 합성 자료로 식별한다. live 성과로 보고하지 않는다.
- 초기 `/api/starter/preview`는 합성 fixture 미리보기다. `/api/v1/*`, persistent worker, live 어댑터의 구현 완료를 뜻하지 않는다.
- 세션·외부 호출·파일 경로·사용자 입력을 클라이언트 판단만으로 신뢰하지 않는다.
- 의미 있는 실패 사례를 함께 확인한다. 예: 늦은 응답, 중복 요청, 오래된 승인, 중간 SSE 오류.
- 기존 테스트가 보호하는 동작을 바꾸면 계약·테스트·결정 기록을 같은 변경으로 정리한다.
- 구현하지 않은 API는 완료 상태로 보고하지 않는다. 호출하지 않은 live/API/브라우저 검증은 `NOT_RUN`으로 남긴다.
- 비밀 값과 실제 이력서를 프롬프트·로그·fixture·커밋에 넣지 않는다. 환경 점검은 값 대신 존재 여부만 출력한다.
- 로컬 수정·검증은 요청 범위 안에서 이어간다. 실제 기업 제출·배포·외부 공유는 별도 작업 범위다.

## 작업을 마칠 때

1. 변경한 동작, 검증 명령과 결과, 남은 문제를 간단히 보고한다.
2. `docs/state/PROGRESS.md`의 해당 상태를 실제 증거에 맞춰 갱신한다.
3. `docs/state/HANDOFF.md`에 다음 한 작업·관련 파일·재현 명령을 남긴다.
4. 코드 위치가 달라졌으면 `docs/CODEMAP.md`, 설계 판단이 달라졌으면 `DECISIONS.md`를 갱신한다.
5. 실제 실행한 결과만 PASS로 기록한다. 실행 환경 문제는 BLOCKED, 미실행은 NOT_RUN으로 구분한다.
