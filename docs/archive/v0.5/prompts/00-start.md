# 최초 실행 — 기반 확인 후 첫 미완료 흐름 구현

Career Evidence를 이 폴더에서 개발해줘. 설명과 결과는 한국어로 작성해줘.

## 먼저 확인

1. CLAUDE.md, README.md, DECISIONS.md, docs/state/PROGRESS.md, docs/state/HANDOFF.md, docs/CODEMAP.md를 읽어줘.
2. Git 상태, package.json의 실제 명령, Node 버전, 기존 구현과 환경 파일의 존재 여부를 확인해줘. 비밀 값은 읽어 출력하지 말고 필요한 키의 존재 여부만 검사해줘.
3. 이미 구현·검증된 항목과 아직 없는 항목을 분리해줘. 기존 파일을 일괄 재생성하거나 최신 프레임워크로 이관하지 말아줘.

## 바로 구현할 첫 흐름

npm run doctor를 실행하고 README에 맞춰 로컬 의존성을 준비해줘. 환경 문제 중 로컬에서 고칠 수 있는 것은 수정하고 이어가줘. 전체 계획 승인만 요청하며 멈추지 말아줘.

초기 킷의 health·합성 preview·SQLite bootstrap은 제품 API 완성을 뜻하지 않아. `/api/starter/preview`는 fixture 화면이며, `/api/v1/*`는 아직 미구현 응답, worker·live adapter는 구현 경계일 수 있어. 이 상태를 직접 확인하고 **세션 → context → mock 검색 task 저장 → worker 처리 → 저장된 후보·작업 조회**를 첫 제품 흐름으로 완성해줘.

1. prompts/01-foundation.md의 세션·context 계약과 prompts/02-search-analysis.md의 검색·작업 계약만 읽어줘.
2. 데모 세션과 합성 프로필 선택, context snapshot 생성·조회, 소유권·Origin·CSRF 검증을 연결해줘.
3. 검색 요청을 idempotency 규칙에 따라 task·search_run으로 저장하고 제품 작업 ID를 반환해줘.
4. persistent worker가 queued 작업을 claim하고 mock provider 결과를 후보로 저장하도록 구현해줘. lease owner·generation 검증과 작업 재조회 경로를 포함해줘.
5. 웹을 실제 제품 API의 작업 상태·저장 후보 조회에 연결해줘. 이 흐름에서 직접 fixture를 읽어 성공을 흉내 내지 말고 mock provenance는 유지해줘.
6. 새로고침 뒤 동일 작업 조회, 중복 검색 요청, 서버/worker 재시작, 다른 세션 조회 거절을 확인해줘. provider 네트워크 호출이 0회인지 검증해줘.

이 흐름이 기존 저장소에서 이미 구현되어 있으면 확인된 결함을 수정하거나 HANDOFF의 다음 미완료 사용자 흐름 한 개를 선택해줘. 첫 실행에 live 호출·실제 구직자 자료·배포는 필요하지 않아.

## 끝낼 조건

변경한 동작의 정상 사례와 관련 실패 사례를 확인하고 typecheck·관련 테스트·필요한 build를 실행해줘. 실행할 수 없는 검증은 이유와 함께 NOT_RUN 또는 BLOCKED로 남겨줘. docs/state의 진행·인계 기록과 코드 위치 안내를 갱신하고, **완료한 사용자 흐름 / 검증 결과 / 남은 것 / 다음 한 작업**으로 보고해줘.
