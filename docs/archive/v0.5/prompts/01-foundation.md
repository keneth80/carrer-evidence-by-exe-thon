# 1단계 — 실행 기반과 세션·context

CLAUDE.md와 docs/state의 현재 상태, CODEMAP을 확인하고 이번 단계의 남은 부분을 구현해줘. 기반 코드가 있으면 검증하고 재사용해줘.

## 읽을 계약

contracts/v0.4/openapi.yaml의 demo/session·session·profiles·contexts, schemas/domain.schema.json의 관련 정의, schema.sql의 workspaces·context_revisions, DB_MAPPING.md.

## 구현 범위

1. React 웹과 API를 동일 origin으로 연결하고 API 주소를 환경에 따라 임의 외부 주소로 바꾸지 않도록 정리해줘.
2. SQLite 연결별 foreign_keys 활성화·기능 확인, 영속 파일 경로, migration 적용 여부를 확인해줘. 기존 DB를 삭제해서 migration 문제를 숨기지 말아줘.
3. 합성 프로필과 데모 세션, 현재 context 조회·변경 API를 계약에 맞춰 구현해줘. 서버가 소유권·Origin·CSRF·입력 형식을 검사해줘.
4. context 변경은 expected_workspace_revision을 검사하고 불변 snapshot을 저장해줘. 화면의 아직 적용하지 않은 입력과 적용된 조건을 분리해줘.
5. worker 진입점과 provider 인터페이스의 책임을 분리하고 기본 mock 실행이 네트워크를 호출하지 않도록 확인해줘.

## 완료 기준

- 합성 프로필 선택→조건 적용→현재 context 재조회가 웹/API/DB로 연결된다.
- 서버 재시작 뒤 저장 자료를 복구할 수 있다.
- 오래된 revision, 다른 세션의 리소스, 잘못된 Origin·CSRF를 거절한다.
- doctor·typecheck·관련 테스트와 DB 계약 검사 결과를 남긴다. 브라우저 실행을 하지 않았다면 화면 검증 PASS로 보고하지 않는다.

이 단계의 결과·다음 작업을 docs/state에 기록하고 실제 코드 진입점을 CODEMAP에 반영해줘.
