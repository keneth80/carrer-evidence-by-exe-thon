# 3단계 — 조건 재평가와 기업 브리프

검색·분석에서 저장한 근거를 활용해 조건 재평가와 회사 1곳 브리프를 구현해줘. docs/state와 CODEMAP을 읽고 기존 구현을 재사용해줘.

## 읽을 계약

contracts/v0.4/openapi.yaml의 re-evaluations·briefs·download, 관련 domain schema, DB_MAPPING.md, LINER_ADAPTER.md, DECISIONS.md의 context·회사 예약·비용 관련 결정.

## 구현 범위

1. 사용자가 조건을 바꾸면 새 context를 만들고 기존 fact bundle을 재평가해줘. 이 경로의 provider 호출 수는 0회여야 해.
2. review / needs_information / hold와 조건별 이유를 match.v1 규칙에 맞춰 표시해줘. preferences 차이와 필수 조건 gap을 구분해줘.
3. 검색 회차의 회사 1곳 예약을 원자적으로 고정해줘. 동시에 다른 회사를 요청하면 이미 예약된 회사 정보를 보여줘.
4. 같은 candidate의 성공한 기업 facts가 있다면 새 context의 브리프를 기존 자료로 조립해줘. 다른 candidate의 facts를 섞거나 확인 시각을 최신으로 바꾸지 말아줘.
5. 브리프에는 공고·조건·평가·기업 근거의 정확한 버전을 묶어줘. 원문·미확인 사항·질문을 포함하고 고정 버전으로 내려받게 해줘.
6. 회사 조사 실패와 호출 불확실성을 보존해줘. 사용자가 다른 브리프 화면을 보는 것만으로 추가 deep research를 실행하지 말아줘.

## 완료 기준

조건 변경 후 재평가에서 provider 호출이 없음을 테스트로 확인한다. 회사 중복 예약·교차 candidate 자료 혼합을 거절한다. 브리프 재조회·내려받기가 같은 snapshot을 나타낸다. 실제 deep research를 실행하지 않았으면 live 검증은 NOT_RUN이다.

검증 결과, 핵심 웹 흐름의 완주 여부와 브라우저 단계 착수 가능 여부를 docs/state에 기록해줘.
