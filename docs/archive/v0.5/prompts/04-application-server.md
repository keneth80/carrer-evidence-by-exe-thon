# 4단계 — 지원 초안·승인·접수 서버

검색→비교→근거 확인의 완료 기록을 확인하고 지원 준비 흐름을 구현해줘. 미완료라면 그 핵심 흐름의 남은 문제부터 마무리해줘. 이번 범위는 합성 자료와 자체 폼이다.

## 읽을 계약

contracts/v0.4/openapi.yaml의 files·applications·form-sessions·approvals·attempts·submissions·reconcile·application-records, 관련 domain schema, schema.sql, DB_MAPPING.md, SPEC.md의 승인·접수 부분.

## 구현 범위

1. 확인된 경력·공고·브리프를 바탕으로 두 문항(experience/motivation)의 템플릿 초안을 만들고 사용자가 수정하게 해줘. 각 500 Unicode code points, 공백만 있는 답변 거절, 입사 가능 시점·동의를 검증해줘.
2. expected_revision으로 충돌을 검출하고 초안·파일·동의 변경 시 이전 pending 승인을 무효화해줘.
3. 승인 snapshot은 서버가 구성해줘. 회사·직무·프로필 버전·target/form session·답변·동의·파일 실제 bytes hash를 모두 묶어줘. 검증된 RFC 8785 JCS 구현을 사용하고 fixture 직렬화를 범용 코드로 복사하지 말아줘.
4. 승인 유효성을 원자적으로 확인·소비하고 prepared attempt를 먼저 저장해줘. Idempotency-Key는 workspace·operation·실제 대상 path·정규화 본문에 결속해줘.
5. multipart 제출에서 실제 파일 bytes와 승인 내용을 다시 확인해줘. receipt 삽입과 received 전이를 같은 DB 트랜잭션에서 처리해줘.
6. GET 조회와 명시적 reconcile을 분리해줘. 접수 기록이 없을 때 이전 attempt를 종료한 뒤 늦게 도착한 제출은 거절해줘. 네트워크 오류·404를 미접수 확정으로 표시하지 말아줘.

## 완료 기준

정상 접수, 오래된 승인, 다른 app·workspace 연결, 첨부 교체, 승인 만료, 중복 요청, 응답 손실 뒤 조회, submit/reconcile 경합을 검증한다. 실제 동시 연결 테스트를 하지 않았다면 순차 테스트와 구분한다. received 응답에는 receipt가 있고, 성공한 접수는 한 application에 하나다.

typecheck·관련 테스트·build 결과와 아직 없는 API/통합 검증을 docs/state에 기록해줘. 외부 기업 지원으로 범위를 확장하지 말아줘.
