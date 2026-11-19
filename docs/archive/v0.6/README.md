# Career Evidence 제품 흐름 검토·정정안 v0.6

작성일: 2026.11.16. 사용자가 추가로 설명한 원본 이력서 기반 검색, 대화형 맞춤 이력서, 브라우저 지원, 유사 공고 자동 지원을 반영한 **검토·개발 인계 문서**다.

이 묶음은 v0.5 실행 코드를 교체하는 스타터킷이 아니다. 기존 v0.2 기획·v0.4 계약·v0.5 코드 파일을 수정하지 않았다. 새 기능의 구현·실제 지원·자동 실행 정책 활성화도 수행하지 않았다.

## 읽는 순서

1. FLOW_REVIEW.md: 원하는 사용자 흐름, 기존 범위와 차이, 자동 지원 정책, 구현 순서.
2. DECISIONS.md: 사용자가 명확히 요청한 방향과 이번 검토에서 제안하는 구현 판단의 구분.
3. CLAUDE_UPDATE_PROMPT.md: 현재 작업 중인 Claude Code 프로젝트에 전달할 정정 지시문.
4. ACCEPTANCE.md: 구현 후 확인할 사용자 시나리오와 실제 검증 범위.

## Claude Code에 전달하기

기존 프로젝트의 코드와 미커밋 변경을 유지한 채 이 문서들을 참고 자료로 추가하고, CLAUDE_UPDATE_PROMPT.md를 읽도록 지시한다. 첫 작업은 원본 이력서 등록→추출 확인→확정 경력→그 경력에서 만든 검색 요청→공고 노출이다. 이후 대화형 맞춤 편집·지원·이력·유사 공고 정책 실행을 순서대로 연결한다.

기존 `prompts/00-start.md`와 `docs/state/HANDOFF.md`의 합성 프로필 중심 첫 과업은 새 의도에 맞춰 갱신해야 한다. 이미 구현한 세션·작업·DB 구조를 다시 만들 필요는 없다. v0.4 원본 계약과 회귀 테스트는 보존하고, 새 의미는 새 계약·migration에 기록한다.

## 검토 근거

- Career_Evidence_Team_Brief_v0.2.pdf: 합성 프로필·자체 폼 범위, 실제 이력서 파싱·실제 기업 제출 제외.
- Career_Evidence_Claude_Code_Starter_v0.5: README, DECISIONS, SPEC, OpenAPI, schema, 실제 preview·adapter·API·worker·확장 코드.
- Ego·Chrome 공식 문서: FLOW_REVIEW.md 하단의 링크. 웹 문서는 기능 조사 근거이며 실행 검증 결과가 아니다.

