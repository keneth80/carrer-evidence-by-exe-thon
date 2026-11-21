# Career Evidence — 코딩 에이전트 안내

이 파일은 Codex 등 다른 코딩 에이전트가 이어서 작업할 때 읽는 요약이다. 자세한 규칙은 `CLAUDE.md`가 기준이고, 내용이 다르면 `CLAUDE.md`와 `DECISIONS.md`를 따른다.

## 먼저 읽을 것

1. `docs/state/HANDOFF.md`의 '협업자 인계'(현재 상태, 알려진 한계, 다음 후보)
2. `CLAUDE.md`(제품 불변 조건, 먼저 물을 것, 검증 방식)
3. `docs/CODEMAP.md`(코드 위치), `DECISIONS.md`(결정과 이유)

## 실행과 검증

- Node.js 24(`.nvmrc`), `npm ci`, `npm run dev`(웹 4310 · API 4311 · worker). 키가 없으면 모든 AI·검색 기능이 mock으로 동작한다.
- 변경 뒤: `npm run typecheck`, `npm test`, 필요하면 `npm run build`, `npm run check:integration`.
- 유료 호출(Liner)은 명령줄 한도(`LINER_MAX_CALLS`, `LINER_CHAT_MAX_CALLS` 등) 안에서만 나간다. 전송 여부가 불명확한 호출을 자동 재시도하지 않는다.

## 반드시 지킬 것

- 경력 사실은 원문 위치나 사용자가 직접 쓴 문장에만 근거한다. AI 문장, 공고 본문, 검색 결과는 근거가 아니다.
- 수치·기술·직책·책임 범위를 지어내지 않는다. 서버의 결정적 검사(`packages/tailor/src/guard.ts`, `screen-changes.ts`)와 근거 검토를 약하게 만들지 않는다.
- 사용자 확인과 제출 승인을 코드나 테스트가 대신하지 않는다. 자체 테스트 폼의 성공을 외부 회사 접수로 보고하지 않는다.
- 비밀값·실제 이력서·개인 경로를 코드·fixture·로그·커밋에 넣지 않는다. 설정은 값 대신 존재 여부만 출력한다.
- 계약(`contracts/v0.7`)을 바꾸면 schema·openapi·README·API_INDEX·MANIFEST를 함께 맞추고, 적용한 migration SQL은 고치지 않고 새 파일을 더한다.
- 테스트나 정답 자료를 약하게 고쳐 통과시키지 않는다. 주석은 '무엇'이 아니라 '왜'를 쓴다.

## 먼저 물을 것

패키지 설치, 아키텍처·DB schema·public API·인증·환경변수 변경, 대규모 이동·리팩터링, 실제 외부 제출.
