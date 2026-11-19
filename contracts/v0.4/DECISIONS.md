# Career Evidence 설계 결정 v0.4

작성일: 2026.11.15. 기준: 팀 기획서 v0.2, UI·UX v0.3. 이 파일은 구현 스타터킷으로 넘길 결정 기록이며, 실제 배포·연동 완료를 뜻하지 않는다.

| ID | 결정 | 이유·적용 범위 |
| --- | --- | --- |
| D01 | React·TypeScript + 영속 TS 서비스/worker + SQLite | 기존 기획의 기반을 이어가며 작업·접수 복구를 DB에 보관한다. 적합한 기존 코드는 재사용한다. |
| D02 | Liner 어댑터와 제품 API 분리 | 공개 Agent API는 긴 SSE/완료 대기 응답이다. 제품 작업 ID·polling·재시도는 서버가 제공한다. |
| D03 | context와 사실·판단을 분리 | 조건 변경은 새 context + 저장 fact bundle 재평가로 처리하여 유료 재검색을 일으키지 않는다. |
| D04 | 검색10/분석3/조사회사1의 단위 명시 | 검색 회차당 후보10, 분석 요청당 서로 다른 후보3, 검색 회차당 심층 조사 company_key1개. 첫 예약을 원자적으로 고정한다. |
| D05 | JSON 묶음과 관계형 제약 함께 사용 | 출처·문항은 검증된 JSON, scope·revision·작업·승인·접수는 FK/고유 제약으로 보호한다. |
| D06 | 초안 답변은 근거 기반 템플릿 | 등록 경력·브리프의 확인된 정보로 두 문항을 만들고 사용자가 수정한다. 기본 경로에 추가 유료 LLM 생성 호출을 넣지 않는다. |
| D07 | CAS + 요청 fingerprint | expected_revision과 Idempotency-Key를 함께 사용한다. fingerprint는 method+실제 대상 path+JCS(body)를 묶는다. |
| D08 | 승인 snapshot은 완전한 제출 내용 | 회사·직무·프로필·폼 인스턴스·답변·파일 bytes hash·동의 버전을 묶는다. 서버가 digest를 계산한다. |
| D09 | 자체 폼 동일 origin + 고정 page bridge | 세션/CSRF는 페이지만 보유한다. 확장은 enum 동작을 요청하고 키·쿠키·임의 URL 실행 권한을 받지 않는다. |
| D10 | 서버 시도와 UI 관측 상태 분리 | server prepared/received/rejected/closed_not_accepted와 UI 접수 확인 필요를 분리한다. |
| D11 | 접수·종결을 같은 DB 쓰기 구간에서 처리 | receipt application/attempt 고유성으로 중복 효과를 막고 reconcile이 먼저 종료하면 늦은 제출을 거절한다. |
| D12 | provider 전송 불명은 자동 재시도하지 않음 | provider exactly-once·중단 확정 계약은 미확인이다. 호출·과금 불확실성을 남기고 명시적으로 재시도한다. |
| D13 | 기존 기업 사실을 재사용해 브리프 재구성 | 같은 candidate의 기업 조사가 이미 성공했다면 새 context의 브리프는 기존 기업 facts로 조립한다. 자료의 원래 확인 시각을 유지한다. |
| D14 | 비용을 정수 micro-USD와 상태로 보관 | 예상 예약·실제 확인·전송 불명을 구분한다. 키·잔액·가격 설정 없이 무제한 live 호출하지 않는다. |

## 구현 시 고정할 제안값

- 폼 연결 30분, 승인 10분, 합성 데모 workspace 7일. 실제 만료는 서버 시각 기준.
- 답변 문항 2개(experience/motivation), 각각 공백만 있는 답변 거절·500자 이내. 입사 시점 필수.
- 합성 PDF 1개, 최대 5,242,880 bytes. API/파일의 크기는 bytes, 문항 길이는 Unicode code points 기준으로 정의한다. 웹의 UTF-16 maxlength만으로 서버 검증을 대체하지 않는다.
- worker 동시 호출 기본1, endpoint별 시작 간격1초. 실제 제한·계정 공유를 고려해 조정한다.
- 자동 유료 provider retry 기본 OFF. 수동 재시도 상한 초기2회는 부모 작업 계보 전체를 기준으로 서버가 검사한다. 개별 child의 retry_count를 초기화해 우회하지 않는다.
- foreign_keys=ON 확인, WAL, synchronous=FULL, busy_timeout 초기5초. 네트워크 호출은 DB TX 밖에서 수행한다.

## 계약의 권위

공개 필드 형식은 schemas/domain.schema.json, HTTP method/status/path는 openapi.yaml, DB 열·트리거는 schema.sql을 따른다. 구현 중 의미가 바뀌면 세 파일과 이 결정 기록·테스트를 같은 변경으로 갱신한다. DB JSON 안의 내부 metadata는 공개 응답에 무조건 노출하지 않는다.

## 보류·별도 확인

- 기존 저장소 점검, 실제 키·크레딧·Liner 응답 품질·일반화된 공고 추출.
- 외부 채용사이트별 권한·약관·로그인·접수 증거·중복 제출 계약.
- 실제 사용자 인증·개인 이력서 보관·삭제·동의 정책, 다중 사용자 운영.
- 영속 디스크가 없는 환경 또는 여러 서버로 확장할 때 DB·큐·파일 저장소 변경.
- Chrome 실제 파일 첨부·서비스워커 재시작·한글 입력·다중 탭·접근성 검증.
- 범용 agent framework나 추가 모델 도입은 이번 계약에서 확정하지 않는다. Liner 전용 요구와 기존 기반을 우선한다.

## 변경 이력

v0.4: 17개 DB 테이블, 29개 API operation, 불변 승인·접수·reconcile 계약을 구체화했다. UI v0.3의 화면을 API에 연결했으며 신규 서비스 구현·배포는 수행하지 않았다.
