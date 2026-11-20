# 오류 기록 (Error Log)

이 파일은 사용자가 보고한 오류와 수정 내역의 누적 기록입니다.
`/harness-core:lessons`가 자동으로 엔트리를 추가하고 관리합니다.

## 운영 규칙

- **즉시 기록**: 사용자가 오류를 보고하면 `/harness-core:lessons`가 즉시 새 E 엔트리 추가
- **수정 추적**: 수정 완료 후 동일 엔트리에 수정 위치/모델/검증 결과 기록
- **자동 승격**: 같은 패턴이 2회 이상 발생하면 lessons-learned.md의 L 엔트리로 승격
- **수정 권한**: `/harness-core:lessons`로만 수정
- **휘발성**: 오래된 E 엔트리는 archive로 이동 가능 (단, L로 승격된 것은 추적 가능하게 보존)

## 엔트리 형식

```markdown
## E{N} — YYYY-MM-DD HH:MM

- **사용자 보고**: "{원문 그대로}"
- **재현 조건**: 가능한 한 구체적으로
- **추정 원인**: 코드 위치, 설계 결함 등
- **수정 위치**: 파일 경로:라인 (수정 후 채움)
- **수정 모델**: 수정한 dev 에이전트 이름 (수정 후 채움)
- **검증 결과**: code-verifier가 통과 확인했는지 (수정 후 채움)
- **유사 과거 오류**: E2, E5 (있으면)
- **승격 상태**: 미승격 / L4로 승격됨
```

---

# 기록된 오류

## E1 — 2026-11-19 11:30

- **사용자 보고**: "1~4번 다 적용해줘, 그리고 발견된 결함 수정해줘." (세션 관찰 결함을 사용자 요청으로 기록: Liner 대화가 사용자 진술의 어미를 바꿔 사실 확인 후보가 제외됨)
- **재현 조건**: 실호출 3: '…코드 리뷰를 맡았어요.'를 보내면 모델이 어미를 바꾼 after를 돌려줌 → screenChanges의 원문 포함 검사에서 '사용자 메시지에 없는 내용' 제외
- **추정 원인**: 모델이 '그대로'라는 지시를 지키지 않음. 원문 포함 여부만 검사
- **수정 위치**: apps/worker/src/tailor-task.ts userSentenceFor, packages/liner/src/chat.ts 지시문 4
- **수정 모델**: 메인 세션(claude-opus-5-5)
- **검증 결과**: 실호출 4 PASS, tests/liner-chat.test.mjs 원문 보정 테스트
- **유사 과거 오류**: 없음

## E2 — 2026-11-19 11:30

- **사용자 보고**: "1~4번 다 적용해줘, 그리고 발견된 결함 수정해줘." (세션 관찰 결함을 사용자 요청으로 기록: AI 점검이 과거 기간(2026.10 종료)을 '미래'로 오판)
- **재현 조건**: 실호출 5: 합성 frontend 이력서 AI 점검 → '종료 시점이 미래' 항목
- **추정 원인**: 모델이 오늘 날짜를 모름
- **수정 위치**: packages/liner/src/review.ts buildReviewRequest(today)
- **수정 모델**: 메인 세션(claude-opus-5-5)
- **검증 결과**: 실호출 6 PASS(과거로 해석), tests/ai-review.test.mjs 기준일 검사
- **유사 과거 오류**: 없음

## E3 — 2026-11-19 11:30

- **사용자 보고**: "1~4번 다 적용해줘, 그리고 발견된 결함 수정해줘." (세션 관찰 결함을 사용자 요청으로 기록: grep -r이 .env까지 훑어 하네스 확인 요청 10회)
- **재현 조건**: grep -rn/-rln 으로 저장소 검색(--exclude-dir만 지정)
- **추정 원인**: grep -r은 .gitignore를 따르지 않아 .env를 읽음
- **수정 위치**: 작업 습관: rg 사용 또는 --exclude='.env*'
- **수정 모델**: 메인 세션(claude-opus-5-5)
- **검증 결과**: 하네스 감사 로그(audit_report.py) 10회 집계
- **유사 과거 오류**: 없음

## E4 — 2026-11-19 11:30

- **사용자 보고**: "1~4번 다 적용해줘, 그리고 발견된 결함 수정해줘." (세션 관찰 결함을 사용자 요청으로 기록: SQLite CHECK 변경용 표 재생성 migration이 FOREIGN KEY constraint failed로 롤백)
- **재현 조건**: 009 첫 시도: defer_foreign_keys 켠 뒤 새 표에 행 복사 → 옛 표 DROP → RENAME
- **추정 원인**: DROP의 암묵 DELETE가 자식 행 위반을 지연 카운터에 올리고, DROP 전에 복사한 행은 카운터를 내리지 못함
- **수정 위치**: contracts/v0.7/migrations/009_docx_intake.sql, 010_resume_review.sql(행을 DROP·RENAME 뒤에 다시 INSERT)
- **수정 모델**: 메인 세션(claude-opus-5-5)
- **검증 결과**: tests/migration.test.mjs v0.7.2·v0.7.3 PASS
- **유사 과거 오류**: 없음

## E5 — 2026-11-19 11:30

- **사용자 보고**: "1~4번 다 적용해줘, 그리고 발견된 결함 수정해줘." (세션 관찰 결함을 사용자 요청으로 기록: 합성 DOCX fixture를 다시 만들 때마다 sha256이 달라짐)
- **재현 조건**: node scripts/make-docx-fixture.mjs를 몇 분 간격으로 실행
- **추정 원인**: jszip이 자동 생성한 폴더 항목에 현재 시각을 넣음(파일 date만 고정)
- **수정 위치**: scripts/make-docx-fixture.mjs createFolders:false
- **수정 모델**: 메인 세션(claude-opus-5-5)
- **검증 결과**: 반복 생성 sha256 동일
- **유사 과거 오류**: 없음

## E6 — 2026-11-19 16:20

- **사용자 보고**: "지금 ego 브라우저에서 테스트해보고 있는데, 이력서를 수정 하려고 등록했는데 읽기 실패 나오고, 수정할 수 있는 방법이 없네. 개선 가능한가?"
- **재현 조건**: 제목에 번호·부제·묶음을 쓴 Word 이력서(`01  핵심 업무 스킬`, `06  경력 | 최근 역할 중심`, `12  학력 · 자격 · 교육`) 등록
- **추정 원인**: packages/resume/src/candidates.ts headingOf가 정확히 일치하는 제목만 인식 → 전체가 머리글 구역 → 후보 0건(NO_FACT_CANDIDATES, 상태 failed). 화면은 이를 '읽기 실패'로 표시하고 '+ 추가'는 hover 때만 보임
- **수정 위치**: packages/resume/src/candidates.ts(headingOf·namedHeading·머리글 기간 줄·긴 기술 조각), apps/web/src/resume/ReviewPage.tsx·StartPage.tsx·resume.css
- **수정 모델**: 메인 세션(claude-opus-5-5)
- **검증 결과**: tests/extraction.test.mjs 9/9, npm test 144/144, 같은 문서 후보 0→198, ego 브라우저 합성 docx 확인
- **유사 과거 오류**: 없음

## E7 — 2026-11-19 22:10

- **사용자 보고**: "첨부이미지를 보면 규칙 점검 결과라고 나오는데, 보완점이나 개선점은 안나오네. 테스트가 된건가?" / "직함은 여러번 있을 수 있고, 회사도 재입사일 때도 있어서 반복으로 나올 수 있는데, 그런걸 규칙으로 나오게 하면 안될거 같은데."
- **재현 조건**: 확정 경력 100개 실제 이력서로 HR 전문가 점검(Liner live, staged). 합성 이력서(12~25개)로만 검증했었음.
- **추정 원인**: ① AI 점검 응답이 최대 15개·긴 설명을 허용해 `max_completion_tokens` 4000에서 잘림(LINER_CHAT_TRUNCATED) → 설계대로 규칙 결과만 표시. ② 중복 규칙이 직함·회사·기간·기술까지 검사.
- **수정 위치**: `packages/liner/src/persona.ts`(FINDING_PROMPT_ITEMS=8·FINDING_LENGTH_RULE), `packages/liner/src/supplement.ts`·`review.ts`·`tailor-stages.ts`(프롬프트에 적용), `packages/tailor/src/review.ts`(중복 안내는 업무·성과·기타 문장만)
- **수정 모델**: 메인 세션
- **검증 결과**: 재현 테스트 FAIL→PASS(`tests/resume-review.test.mjs`), npm test 193/193. 같은 실제 이력서로 실호출 재확인: 'HR 전문가 점검 ✓ 8개 추가', 질문 8개, 약 14초, 실패 표시 없음(내용은 기록하지 않음).
- **유사 과거 오류**: 없음(실제 대용량 입력에서만 드러난 첫 사례)
