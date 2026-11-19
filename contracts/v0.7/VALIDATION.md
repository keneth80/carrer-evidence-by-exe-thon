# v0.7 계약 검증 결과

검증일: **2026-11-16, Asia/Seoul**. 상태: **CONTRACT_SHAPE_AND_DB_CHECKS_PASS**.

## 실행 결과

| 검증 | 결과 | 실제 범위 |
| --- | --- | --- |
| Python unittest | **38 PASS** | schema/API 구조 11개 + 격리 SQLite 제약 27개 |
| JSON Schema | PASS | Draft 2020-12 문서 자체와 공개 정의 60개 |
| 합성 예제 | PASS | 12개 JSON 객체. 각 예제에 연결된 공개 정의로 검증 |
| OpenAPI 참조·구조 | PASS | 48개 작업의 schema 참조, operation ID 유일성, path parameter, 쓰기 idempotency/body, 성공 응답 존재 |
| 추가 SQL | PASS | 임시 메모리 DB에서 v0.4 뒤에 ce7_* 테이블 29개와 트리거 34개 생성 |
| baseline 보존 | PASS | migration 전후 v0.4의 기존 sqlite_master 객체 SQL이 동일 |
| FK 검사 | PASS | 테스트 초기 데이터의 PRAGMA foreign_key_check 결과 없음 |
| 사용자 파일 DB migration | **NOT_APPLIED** | 실제 DB와 runtime 초기화기는 변경하지 않음 |
| 제품 API/worker/브라우저 | **NOT_RUN** | 이 계약 검사로 제품 구현 완료를 주장하지 않음 |
| Liner·대화 모델·실제 기업 지원 | **NOT_RUN** | 외부 유료 호출·로그인·기업 제출 없음 |

OpenAPI 검사는 현재 의존성인 PyYAML·jsonschema를 이용한 **참조 폐쇄성과 구조 검사**다. 공식 OpenAPI 전체 적합성 검사기를 실행했다고 표시하지 않는다. SQLite 검사는 provider의 실제 과금, 브라우저 입력, 회사 접수를 보장하지 않는다.

## 확인한 핵심 경계

- 합성 session으로 실제 사용자 문서를 저장하는 경로 거절.
- 타 workspace의 fact revision 참조, 원본 hash 덮어쓰기, 확정 사실 수정 거절.
- final이 아닌 이력서의 artifact 생성, 실제 파일 관계와 다른 hash 연결 거절.
- 수동 권한과 정책 권한의 구분, 다른 공고의 권한 재사용, 같은 권한의 재소비 거절.
- unknown 상태의 새 시도와 자동 미접수 판정 거절. 접수 증거가 있어야 submitted 전환.
- 정책 중지 후 신규 attempt/dispatch 거절, quota 없는 정책 dispatch 거절.
- pending 예약도 일일 한도에 포함. 전송 불명 quota 환불 거절.
- 고정 seed 변경 거절. 동일 이력서 파일을 다른 공고의 **새 policy 권한**으로 연결하는 정상 경로 허용.
- submission_state와 recruitment_stage 분리. 채용 불합격을 제출 실패 enum으로 사용하지 않음.

## 검토에서 수정한 결함

독립 검토에서 `ce7_applications.job_key`를 바꾸면 unknown 지원이 점유한 중복 키를 비우고 새 지원을 만들 수 있는 경로가 확인됐다. `ce7_application_identity` 트리거로 id/workspace/job_key/생성 출처/생성 시각을 고정했다. unknown 상태의 job_key 변경이 실패하고 같은 원래 job_key의 새 application도 거절되는 회귀 검사를 추가했다.

금지 전이의 실패 이유가 SQLite의 trigger 실행 순서에 따라 `INVALID_ATTEMPT_TRANSITION` 또는 `DISPATCH_TIME_IMMUTABLE`로 나타날 수 있어, 검사에서는 두 보호 경로 모두 같은 금지 동작을 막는 것으로 확인한다. 실제 금지 동작을 허용하도록 SQL을 완화하지 않았다.

## 재현

프로젝트 루트의 준비된 Python 환경에서 실행한다.

```bash
python -m unittest discover -s contracts/v0.7/tests -v
```

후속 구현에서는 별도로 원본 bytes 추출·사용자 확인, 검색 결과 변화, 대화 diff, 실제 PDF 출력, 계정·폼 readback, receipt 확인, pause/dispatch 경쟁, 재시작 복구를 검증해야 한다. 기존 또는 신규 계약 테스트 수만으로 그 통합 검증을 대체하지 않는다.
