# 2단계 — 검색·분석·비교·근거 확인

기반 구현을 보존하면서 검색부터 근거 확인까지 연결해줘. docs/state를 읽고 가장 작은 미완료 흐름부터 시작해줘. 한 번에 독립적인 화면·기능을 모두 재작성하지 말아줘.

## 읽을 계약

contracts/v0.4/LINER_ADAPTER.md, openapi.yaml의 searches·analyses·tasks·fact-bundles·assessments, schema.sql의 tasks·provider_calls·search_runs·job_candidates·fact_bundles·assessments, 관련 JSON Schema.

## 구현 범위

1. 검색 요청을 task와 search_run으로 저장하고 최대 10개 후보를 조회하게 해줘. 실제 후보 수를 유지하고 빈 자리를 가상 live 결과로 채우지 말아줘.
2. 같은 회차의 서로 다른 후보 1~3개를 선택해 분석하도록 연결해줘. 각 공고의 사실과 사용자 조건 판정을 따로 저장해줘.
3. worker의 claim·lease·heartbeat·generation 검증을 구현해줘. 늦은 worker 결과가 현재 소유 작업이나 다른 context의 화면을 갱신하지 못하게 해줘.
4. mock으로 정상·빈 결과·부분 실패·출처 누락·자료 충돌·늦은 응답을 재현해줘. 단계가 완료되면 실제 Liner 어댑터가 같은 내부 형식으로 정규화되도록 연결해줘.
5. live 모드는 실제 키·예산·가격·호출 간격이 설정된 경우에만 사용해줘. SSE의 HTTP 200·DONE만으로 성공 처리하지 말고 오류 이벤트와 최종 정규화 결과를 검사해줘.
6. 전송 여부가 불명확한 호출은 자동 유료 재시도하지 말고 비용·결과 불확실성을 보존해줘.
7. 웹에 진행 상태, 비교 결과, 판단 이유, 원문 링크·인용·수집 시각을 표시해줘. source 미확인을 gap으로 바꾸지 말아줘.

## 완료 기준

검색→후보 선택→분석→비교→출처 열람을 끝까지 수행할 수 있다. 새로고침·작업 실패·0개 결과·부분 성공이 구분된다. fixture와 실제 provider 결과는 명확히 식별된다. 승인된 분석 범위를 초과한 요청과 중복 후보는 서버에서 거절한다.

typecheck·관련 단위/통합 테스트·빌드와 실제로 수행한 브라우저 검증을 기록해줘. live 미호출이면 NOT_RUN으로 남기고 mock 성공만 보고해줘. docs/state와 CODEMAP을 갱신해줘.
