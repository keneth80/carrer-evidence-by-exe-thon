# Career Evidence v0.4 검증 기록

검증 기준일: 2026.11.15. 대상은 데이터·HTTP API·확장 메시지 **계약 산출물**이다. 실제 서비스 구현 또는 배포 완료 보고서가 아니다.

## 실행 환경과 결과

| 항목 | 결과 |
| --- | --- |
| Python | 3.12.14 |
| SQLite | 3.53.1 |
| PyYAML | 6.0.3 |
| jsonschema | 4.26.0 |
| 실행 명령 | `python3 -m unittest discover -s tests -v` |
| 실행 위치 | 이 문서가 있는 계약 묶음의 루트 |
| 전체 결과 | **61개 통과, 실패 0개, 오류 0개** |
| DB 검증 | `tests/test_database.py` 34개 |
| schema·예제·API 검증 | `tests/test_contracts.py` 27개 |

마지막 실행 출력은 `Ran 61 tests in 0.875s`와 `OK`였다. 이후에는 검증 기록 작성·PDF 시각 점검·전달용 압축만 수행했으며, 검증 대상 SQL·schema·API·예제를 변경하지 않았다.

## 산출물 범위

| 산출물 | 확인한 범위 |
| --- | --- |
| SQLite | 17개 테이블 및 관련 인덱스·트리거. 빈 DB에 schema 적용 |
| HTTP 계약 | OpenAPI 3.1.1, 28개 path의 29개 operation |
| 도메인 schema | JSON Schema 2020-12, `$defs` 65개 |
| 확장 schema | 별도 진입 schema와 로컬 registry를 통한 도메인 schema 참조 |
| 예제 | manifest에 등록한 합성 요청·응답 19개, 형식 검증 포함 |
| digest 예제 | canonical payload의 실제 UTF-8 bytes 및 SHA-256 일치 |
| 파일 예제 | 가상 PDF의 실제 크기·SHA-256과 payload·파일 metadata 일치 |
| PDF | 설계 문서 19쪽 전체 렌더링 및 시각 점검. 페이지 밖 텍스트·replacement glyph 없음 |

## DB에서 확인한 핵심 제약

- 다른 workspace·candidate·application의 자료를 연결하는 잘못된 FK를 거절한다.
- 검색 회차의 11번째 후보, 중복 공고, 다른 회사로의 조사 예약 변경을 거절한다.
- context·사실·평가·revision·승인 내용·접수 기록의 불변 조건을 확인한다.
- 오래된 revision이나 다른 지원 건에 대한 승인을 사용할 수 없다. 초안 변경 시 기존 pending 승인이 무효화된다.
- 활성 제출 시도가 있거나 이미 접수된 지원 건의 편집·추가 제출을 제한한다.
- 접수 기록의 application·attempt 고유성을 확인한다. 종료된 시도에 늦게 도착한 접수는 거절한다.
- receipt를 기록해야 received 상태가 되며, 승인 소비와 접수 상태 변경의 트리거 순서를 확인한다.
- 만료·취소된 폼, 비용 상태·금액의 불일치, 작업 결과·상태의 불일치를 거절한다.
- 재시도 계보와 기존 회사 사실의 새 context 브리프 재사용 관계를 확인한다.

분석 요청의 후보 1~3개 제한은 API 입력·서비스 계층의 책임이다. DB 테스트에는 이 경계를 드러내는 사례도 포함된다. 모든 제품 규칙이 SQL만으로 강제된다는 의미가 아니다.

## 계약에서 확인한 핵심 제약

- 요청 후보 4개 또는 중복 후보를 거절한다.
- 자료 미확인을 거짓 또는 조건 미충족으로 표현하는 형식을 거절한다.
- known·conflicting 사실의 근거 요구, 동의, 필수 문항 ID, 공백만 있는 답변과 500자 초과를 확인한다.
- 제출 성공 응답에는 received 상태와 receipt가 필요하다. reconcile 완료 응답에 prepared를 허용하지 않는다.
- 확장 메시지의 허용되지 않은 동작·추가 비밀 정보 필드·불일치 payload를 거절한다.
- OpenAPI의 로컬 `$ref`, operationId 고유성, path parameter, 인증·CSRF 계약, 변경 요청의 idempotency 적용을 확인한다.
- PDF bytes hash, 승인 payload, 제출 envelope, 확장 메시지 예제 사이의 연결을 확인한다.

## 이번 단계에서 실행하지 않은 검증

| 항목 | 상태와 다음 단계 |
| --- | --- |
| 전체 OpenAPI 표준 meta-validator·SDK 생성 | **NOT_RUN**. 로컬 참조·구조 일관성 테스트와 구분한다. 구현 도구를 정한 뒤 검증한다. |
| 실제 HTTP handler | **NOT_RUN**. 세션 소유권·Origin·CSRF·서버 시각·전체 JSON 관계·JCS 재계산을 구현하고 검증해야 한다. |
| Liner live API | **NOT_RUN**. 실제 키·예산·입출력·출처 품질·SSE 중간 오류·호출 제한을 검증해야 한다. |
| worker 및 재시작 | **NOT_RUN**. 영속 큐·lease·heartbeat·generation CAS·중단·불명 호출 처리를 통합 검증해야 한다. |
| submit/reconcile 동시 경합 | **NOT_RUN**. 로컬 DB 테스트는 제약과 순차 시나리오를 검증했다. 서로 다른 연결의 동시 요청·busy 재시도는 별도 검증해야 한다. |
| Chrome 확장 | **NOT_RUN**. 실제 탭·document 교체, service worker 종료, 한글 입력, File/DataTransfer, 첨부·readback·버튼 흐름을 구현하고 검증해야 한다. |
| 실제 브라우저 E2E | **NOT_RUN**. 검색부터 비교·근거·초안·자체 폼 접수까지 연결한 뒤 검증해야 한다. |
| 범용 JCS 구현 | **NOT_RUN**. 예제 직렬화는 ASCII key와 정수만 사용하는 fixture 도우미다. RFC 8785 전체 구현으로 사용하지 않는다. |
| 외부 기업 지원·운영 배포 | **NOT_RUN**. 이번 계약은 합성 자료와 자체 테스트 폼 1종 범위다. |

## 재현

Miniconda 환경 생성과 의존성 설치 명령은 README.md에 있다. API 키·네트워크·실제 지원 계정 없이 계약 테스트를 재현할 수 있다. SQL 연결별 `foreign_keys=ON`과 실제 배포 환경의 SQLite 기능은 구현 시 다시 확인한다.

`MANIFEST.sha256`은 이 파일을 포함한 전달 파일의 무결성 목록이다. manifest 자체와 Python 캐시는 목록에서 제외한다. 압축 파일의 CRC 점검은 전송 파일의 손상을 검사하며, 위에서 실행하지 않은 통합 검증을 대체하지 않는다.
