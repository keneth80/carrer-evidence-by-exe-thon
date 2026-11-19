# 코드 위치 안내

현재 v0.5 foundation의 실제 파일 기준이다. 기능을 찾을 때 해당 행의 파일부터 읽고, 새 경로를 만들거나 책임을 옮기면 이 표를 갱신한다.

| 수정하려는 기능 | 먼저 읽을 파일 | 연결 계약·주의 |
| --- | --- | --- |
| 개발 명령·의존성 | package.json, scripts/dev.mjs | Node 24.x, npm ci, lockfile |
| 환경·mock/live 분기 | apps/api/src/config.ts | 실제 key 값 출력 금지. live는 아직 오류 |
| 서버 진입·종료 | apps/api/src/main.ts | 프로세스·DB 수명. worker와 별도 책임 |
| HTTP 경로·Origin·Host | apps/api/src/server.ts | 현재 health/preview만. v0.4 openapi.yaml의 제품 handler를 추가 |
| 합성 비교 응답 | apps/api/src/preview.ts | dev namespace. task/context 저장 경로 아님 |
| DB 초기화·객체 변경 감지 | packages/db/src/index.ts | schema.sql/DB_MAPPING.md. 자동 reset 금지 |
| 판정 규칙·답변 길이 | packages/domain/src/index.ts | match.v1, unknown/gap 분리, LF/Unicode code points |
| Liner 어댑터·fixture | packages/liner/src/index.ts | LINER_ADAPTER.md. 현재 network 없는 mock |
| preview 응답 타입 | packages/shared/src/preview.ts | v0.4 제품 Assessment와 별도인 개발용 구조 |
| 비교·근거·테스트 폼 UI | apps/web/src/App.tsx | 실제 작업 ID/context로 연결할 자리 |
| UI 스타일·진입 | apps/web/src/style.css, main.tsx | 원격 font/CDN 의존성 없음 |
| 웹 개발 proxy·빌드 | apps/web/vite.config.ts | 웹4310, API4311, strictPort |
| 영속 worker | apps/worker/src/main.ts, README.md | 현재 exit 1. lease/claim/result CAS 구현 필요 |
| Chrome 권한·진단 | apps/extension/manifest.json, guard.mjs, service-worker.js | docs/EXTENSION_START.md, EXTENSION_PROTOCOL.md |
| Chrome 패널 | apps/extension/sidepanel.html, sidepanel.js, sidepanel.css | 진단 전용. 입력·첨부·승인·접수는 미구현 |
| foundation 검증 | tests/foundation.test.mjs | DB 보존·drift·preview·미구현 경계 |
| 실제 HTTP 검증 | scripts/smoke-http.mjs | memory DB·임의 local port, 실제 요청6개 |
| 도메인·어댑터 검증 | tests/domain.test.mjs, tests/liner.test.mjs | 의미·비용 경계 테스트 |
| 확장 요청 검증 | apps/extension/guard.test.mjs | 정확한 URL·sender·operation |
| 계약 복사본 검증 | scripts/check_contracts.py | baseline hash + 61 tests + 생성 mock schema |
| 빌드 | scripts/build.mjs | dist/web, dist/extension. 배포 수행 없음 |
| 작업 재개 | docs/state/HANDOFF.md, PROGRESS.md | 결과 증거를 기준으로 다음 한 작업 결정 |

## 아직 찾을 수 없는 기능

세션 repository, context service, 제품 search/task handler, queue claim loop, live SSE parser, draft/approval/receipt 서비스, page bridge는 아직 구현하지 않았다. 이름이 비슷한 preview·fixture 함수를 제품 구현으로 연결하지 않는다. 첫 위치와 순서는 `prompts/00-start.md`에 있다.

