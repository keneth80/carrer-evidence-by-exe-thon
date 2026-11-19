# Claude Starter v0.5 검증 결과

기준일: 2026.11.15 · 결과: **STARTER_FOUNDATION_READY**

Claude Code에서 다음 제품 흐름을 구현할 수 있는 기반을 검증했다. 제품 API·영속 worker·실제 Liner·자동 지원이 완성됐다는 판정이 아니다.

## 확인한 환경

| 항목 | 실제 값 |
| --- | --- |
| Node | v24.22.1 |
| npm | 11.9.0 |
| React / React DOM | 19.3.1 / 19.3.1 |
| TypeScript | 7.0.2 |
| Vite / React plugin | 8.3.8 / 6.3.0 |
| Python | 3.12.14 |
| Python 계약 의존성 | PyYAML 6.0.3, jsonschema 4.26.0 |
| Claude Code CLI | 이 작성 환경에 없음. 사용자 환경에서 실행 필요 |

정확한 패키지 의존성과 integrity는 package-lock.json에 기록했다. npm 전역 업데이트나 Claude 모델·계정·권한 설정은 변경하지 않았다. 코드 실행 중 외부 Liner 호출은 없다.

## 실행 결과

| 검증 | 결과 | 확인한 범위 |
| --- | --- | --- |
| 의존성 설치 | PASS | npm install로 lock 생성 후 npm ci로 재설치 확인 |
| npm run doctor | PASS | Node·필수 파일·설치 패키지·mock 설정. Claude 로그인 검증은 별도 |
| npm run typecheck | PASS | 서버·도메인·웹 TS/TSX |
| npm run build | PASS | React/Vite 정적 bundle + 확장 파일 복사 |
| npm test | **26 PASS** | 도메인8 / 어댑터7 / foundation8 / 확장 guard3 |
| npm run db:check | PASS | memory DB에 제품17 + metadata1, FK ON, FK 위반 없음 |
| npm run check:contracts | **61 PASS + 생성 객체9개 PASS** | v0.4 원본 hash, SQL/schema/API 예제, 새 mock의 schema 연결 |
| npm run smoke:http | **실제 HTTP 요청 6개 PASS** | health·필수/선호 preview·잘못된 입력400·제품 미구현501·다른 Origin403 |
| npm run dev | STARTED | API와 Vite 준비 로그 확인. 검증 후 프로세스 종료 |
| 브라우저 화면 자동 검증 | **BLOCKED_ENV** | 시스템 Chromium이 socket() Operation not permitted로 시작 중 종료 |
| 실제 Chrome 확장 | **NOT_RUN** | 권한 부여·side panel·scripting·실제 DOM 검증은 사용자 환경에서 필요 |
| Claude Code 첫 프롬프트 실행 | **NOT_RUN** | CLI 없음. 지침·문서·명령 구성만 검토 |
| 실제 Liner·기업 제출·배포 | **NOT_RUN** | 이번 스타터 작업에서 실행하지 않음 |

마지막 DB 연결 설정 보완 후 관련 foundation 테스트 8개와 실제 HTTP 6개를 다시 확인했다. Node tests 26개와 Python 계약 tests 61개는 서로 다른 검증 묶음이다. 생성 객체9개와 HTTP6개를 같은 단위의 테스트 개수로 합산하지 않는다.

## 의미 있는 확인 사항

- 필수 정보가 없으면 needs_information이며, 출근이 명시된 원격 조건 차이는 hold다. 선호 조건으로 바꿔도 미확인·차이의 이유는 보존한다.
- mock 결과를 수정해도 다음 호출의 원본이 바뀌지 않고, 실제 공고를 합성 사실로 덮어쓰지 않는다.
- live 어댑터의 세 동작은 네트워크 호출 없이 LIVE_ADAPTER_NOT_IMPLEMENTED로 종료한다.
- 기존 DB를 다시 열 수 있고, 기준 SQL 변경·보호 트리거 삭제·알 수 없는 기존 DB는 오류로 종료한다. 초기화 실패 시 부분 테이블을 남기지 않는다.
- 제품 API와 worker가 미구현임을 health·상태 문서·실행 오류에 표시한다. preview는 task를 생성하지 않는다.
- 확장 guard는 정확한 URL·자체 panel sender·허용 진단 동작만 받는다. 실제 Chrome API 동작은 guard 테스트만으로 확인되지 않는다.

## 브라우저 검증의 한계

자동화용 기본 Chromium binary가 없어 설치된 `/usr/bin/chromium`으로 확인했으나, 실행 환경의 OS 소켓 제한으로 브라우저가 종료됐다. 이로 인해 화면 렌더링·키보드 동작·모바일 overflow·클릭 상호작용은 PASS로 기록하지 않았다. 웹 코드는 빌드와 타입 검사를 통과했으며, 조건별 서버 응답은 실제 HTTP로 확인했다.

사용자 개발 환경에서는 README대로 실행한 뒤 아래 순서를 확인한다.

1. 필수 원격 조건: 지원 검토 / 추가 확인 / 보류의 3개 카드.
2. 선호 원격 조건: 3개 모두 지원 검토, 미확인·차이 설명 유지.
3. 각 ‘판단 근거 보기’ 버튼: 선택 회사와 출처 설명 일치.
4. 좁은 화면·Tab 키 이동·로딩·API 오류 표시.
5. /demo/apply: 폼 표식1개, 제출 버튼 disabled.
6. 확장 로드와 폼 진단: docs/EXTENSION_START.md의 수동 절차.

## 남은 제품 통합 검증

세션 격리·CSRF·제품 JSON Schema 입력 검증·idempotency·작업 lease 경쟁·서버/worker 재시작·live SSE·비용 예약·actual file bytes·승인 digest·submit/reconcile 경합은 각 기능 구현 후 수행한다. SQL 제약 테스트와 scaffold build를 이들 통합 검증으로 대체하지 않는다.

