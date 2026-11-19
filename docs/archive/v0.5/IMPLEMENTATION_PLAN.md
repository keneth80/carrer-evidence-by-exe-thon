# 구현 순서와 완료 기준

이 문서는 v0.4 계약을 실행 코드로 옮기는 순서다. 현재 완료 여부는 `docs/state/PROGRESS.md`와 해당 검증 증거를 따른다. 프롬프트가 존재하거나 scaffold가 빌드된 사실만으로 기능 완료로 판정하지 않는다.

## 단계별 범위

| 단계 | 읽을 프롬프트 | 사용자 흐름·완료 기준 |
| --- | --- | --- |
| 0 | `prompts/00-start.md` | 상태 점검 후 세션→context→mock 검색 작업 저장→worker→저장 후보 조회를 첫 제품 흐름으로 구현·검증 |
| 1 | `prompts/01-foundation.md` | 단일 origin 웹/API, 영속 SQLite, 합성 프로필·세션·context가 연결되고 재시작 후 복구 |
| 2 | `prompts/02-search-analysis.md` | 검색→후보 선택→분석→비교→근거 확인. 정상·빈 결과·부분 실패·늦은 응답을 구분 |
| 3 | `prompts/03-brief-reevaluation.md` | 조건 변경 재평가는 provider 호출 0회. 회사 1곳 브리프와 근거·확인 시각 유지 |
| 4 | `prompts/04-application-server.md` | 답변·첨부·동의 revision→승인→시도→자체 폼 접수. 중복·만료·reconcile 검증 |
| 5 | `prompts/05-browser-extension.md` | 자체 테스트 폼 1종에서 실제 입력·첨부·readback·최종 확인·접수와 재시작 복구 |
| 6 | `prompts/06-demo-release.md` | 데모 경로 완주, 실패 설명, 공개할 자료 점검, 제출 자료·재현 절차 준비 |

## 개발 기간의 우선순위

기존 기획의 11/18 기준으로 **검색→비교→출처 확인**이 완주하면 브라우저 지원에 착수한다. 이 조건이 충족되지 않으면 핵심 웹 흐름을 우선하고, 확장 준비 상태를 그대로 기록한다. 11/23~24는 통합·회귀·데모 정리 구간으로 사용한다. 날짜가 지난 시점에 재개하면 달력 숫자를 승인 게이트로 삼지 말고 실제 완료 기준과 남은 일정을 다시 정한다.

실제 Liner 활용은 대회 데모에서 드러나야 한다. mock은 개발·장애 재현을 위한 기반이며, live 통합 여부와 호출 결과를 별도로 기록한다. live 호출은 설정된 키·예산·속도 제한 안에서 수행한다.

## 서로 연결해야 하는 계약

| 기능 | 우선 읽을 계약 | 실제 구현에서 추가 확인할 것 |
| --- | --- | --- |
| 세션·context | `openapi.yaml`, `domain.schema.json`, `schema.sql` | 소유권, Origin·CSRF, 서버 시각, immutable snapshot |
| 검색·분석 | `LINER_ADAPTER.md`, tasks/provider schema | SSE 오류, lease CAS, source 정규화, 비용 상태 |
| 재평가·브리프 | assessment/brief schema, `DB_MAPPING.md` | source/profile 미확인, 회사 예약, 기존 facts 재사용 |
| 승인·접수 | application/approval/attempt schema, `DB_MAPPING.md` | canonical payload, 실제 PDF hash, 원자적 receipt·종결 |
| 확장 | `EXTENSION_PROTOCOL.md`, extension schema | Chrome sender, exact origin·frame·document, 실제 파일 입력 |

표의 파일은 `contracts/v0.4/` 아래에 있다. 프로젝트 구현 경로는 CODEMAP을 따른다.

초기 킷의 `/api/starter/preview`는 fixture 기반 개발 미리보기이며 제품 API·worker의 통합 완료 증거가 아니다. 0단계에서 저장된 작업과 후보를 조회하는 실제 제품 경로를 만든 뒤, 1단계의 남은 기반 검증과 2단계의 분석·근거 기능을 이어간다. 이미 완성한 흐름을 단계 번호 때문에 다시 구현하지 않는다.

## 상태와 보고

`IMPLEMENTED`는 코드가 존재한다는 뜻이며, `VERIFIED`는 명시한 환경에서 검증했다는 뜻이다. 결과는 PASS / FAIL / BLOCKED / NOT_RUN으로 기록하고, mock과 live, 단위·통합·브라우저 검증을 구분한다. 선언되지 않은 endpoint가 성공처럼 응답하거나 mock 데이터를 live로 표시하는 상태는 완료로 보지 않는다.

각 단계의 인계에는 다음 네 가지만 남긴다: 사용자에게 달라진 동작, 실제 검증 명령과 결과, 남은 위험·환경 제약, 다음 한 작업. 작은 범위의 수정 때문에 관계없는 전체 테스트를 반복하지 않고, 남은 구체적 위험을 확인하는 검사로 마무리한다.
