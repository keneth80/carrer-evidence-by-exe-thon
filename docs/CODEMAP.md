# 코드와 명세 위치 안내 — v0.7

이 표는 현재 제공된 기반 코드의 실제 경로와 신규 구현에서 연결할 문서를 구분한다. 이름이 비슷한 preview·fixture 함수를 제품 구현으로 오인하지 않는다. 파일을 추가하거나 책임을 옮기면 이 표와 상태 기록을 함께 갱신한다.

## 현재 존재하는 코드

| 수정하려는 기능 | 실제 진입 파일 | 현재 상태·연결할 작업 |
| --- | --- | --- |
| 명령·의존성 | `package.json`, `scripts/dev.mjs` | Node 24.x, npm lockfile. PDF 추출 `pdfjs-dist` 5.7.284, PDF 생성 `pdf-lib` 1.17.1·`@pdf-lib/fontkit` 1.1.1 |
| 환경·mock/live | `apps/api/src/config.ts` | 검색 mock 기본·live는 키·`LINER_MAX_CALLS`·`LINER_BUDGET_MICRO_USD` 필수(S03), `AUTH_MODE=local_dev`만 허용, 업로드·세션·추출/검색 lease·worker 주기, `OBJECT_DIR` |
| 서버 수명 | `apps/api/src/main.ts` | 로컬 API·DB·파일 저장소 연결, 추출 작업 시작 시·주기 복구 |
| HTTP·Host·Origin | `apps/api/src/server.ts`, `apps/api/src/http.ts` | health/preview, 본문 한도, `/api/v1` 제품 라우터 연결. S03 이후 경로는 501 |
| 합성 미리보기 | `apps/api/src/preview.ts` | 고정 query와 fixture 진단. 실제 검색 파이프라인과 분리 |
| DB 초기화·migration | `packages/db/src/index.ts` | v0.4 baseline + v0.7 `007_resume_workflow.sql` 버전별 적용·digest 검증. reset 없음 |
| 일부 평가·답변 정규화 | `packages/domain/src/index.ts` | unknown/gap 구분 등 재사용 |
| Liner 어댑터(구형 preview용) | `packages/liner/src/index.ts` | preview 진단용 mock과 미구현 live(v0.4 분석용). 제품 검색 live는 `packages/liner/src/web-search.ts`(S03) |
| preview 타입 | `packages/shared/src/preview.ts` | 진단용 구조. 신규 제품 타입과 구분 |
| 웹 화면·경로 | `apps/web/src/App.tsx`, `apps/web/src/router.ts` | `/start`·`/resumes/:id/review`(S01), `/resumes/:id/search`·`/searches/:id`(S02), `/tailoring/:id`·`/tailoring/:id/final`(S04), `/applications`·`/applications/:id`(S05), `/campaigns/new/:지원건`·`/campaigns/:id`(S06), `/preview`(합성 진단), `/demo/apply`·`/demo/apply/:공고`(자체 테스트 폼 사이트, 세션 없음) |
| 웹 스타일·진입 | `apps/web/src/style.css`, `apps/web/src/resume/resume.css`, `apps/web/src/search/search.css`, `apps/web/src/main.tsx` | 기본·S01·S02 화면 스타일 |
| 웹 개발 proxy | `apps/web/vite.config.ts` | 웹4310/API4311 |
| worker | `apps/worker/src/main.ts`, `search-task.ts`, `lease.ts`, `tailor-task.ts`, `render-task.ts`, `observe-task.ts`, `apps/worker/README.md` | `search_jobs` claim·lease·heartbeat·CAS·취소·재시작 복구(mock provider). `scripts/dev.mjs`가 API health 뒤 시작 |
| Chrome 설정·진단 | `apps/extension/manifest.json`, `guard.mjs`, `service-worker.js` | 자체 폼 표식 진단. 실제 입력·첨부·제출은 구현 대상 |
| Chrome 패널 | `apps/extension/sidepanel.html`, `sidepanel.js`, `sidepanel.css` | 연결·작업·인계 상태 구현 필요 |
| 코드 검사 | `tests/foundation.test.mjs`, `tests/domain.test.mjs`, `tests/liner.test.mjs` | 현재 기반 회귀 |
| S01 검사 | `tests/resume-intake.test.mjs`, `tests/extraction.test.mjs`, `tests/migration.test.mjs`, `tests/helpers/s01-harness.mjs` | 실제 HTTP 등록·추출·확정·소유권·재시작, 후보 규칙·lease·복구, v0.4→v0.7 전환 |
| 확장 경계 검사 | `apps/extension/guard.test.mjs` | sender·URL·operation 경계 |
| S02 검사 | `tests/search-plan.test.mjs`, `tests/resume-search.test.mjs`, `tests/helpers/s02-harness.mjs` | 검색 계획·조건·판정 단위, 실제 HTTP + worker 통합(lease·취소·재시작·소유권·idempotency) |
| HTTP 검사 | `scripts/smoke-http.mjs` | endpoint 경계 + S01 로컬 세션 + S02 검색 접근 |
| 계약 검사 | `scripts/check_contracts.py`, `scripts/s01-contract-sample.mjs` | baseline·v0.7 계약 + S01·S02 실제 응답의 schema 검증 |
| 빌드 | `scripts/build.mjs` | 웹·확장 산출물. 배포는 별도 |

## S01 이력서 등록·확정 코드 (2026-11-17 구현)

| 책임 | 경로 | 내용 |
| --- | --- | --- |
| 로컬 개발 세션·CSRF | `apps/api/src/auth.ts` | `POST/DELETE /api/v1/local-dev/session`, 세션→workspace 결정, Origin·CSRF 확인 |
| 제품 라우터 | `apps/api/src/product.ts` | S01·S02·S04·S05 경로 처리, 나머지 `/api/v1`은 501. 실행기(`/api/executor/v1`)·자체 폼 사이트(`/api/demo-site`)는 `server.ts`가 따로 연결 |
| Idempotency | `apps/api/src/idempotency.ts` | `ce7_request_keys` 재생·충돌 409 |
| 원본 등록 | `apps/api/src/resume/intake.ts` | PDF multipart·붙여넣기, 형식·크기·hash, 합성 판정, 원본 재열람 |
| 확인·확정 | `apps/api/src/resume/review.ts` | 목록·문서·추출 초안·원문·task·fact revision 조회, 확정 CAS |
| 추출 작업 | `apps/api/src/resume/extraction.ts` | `extract_resume` claim·lease·결과 저장·복구 |
| 저장소·조회 | `apps/api/src/resume/storage.ts`, `apps/api/src/resume/repository.ts` | 파일 저장(ID 경로만), workspace 조건 SQL |
| 추출 규칙 | `packages/resume/src/pdf.ts`, `pdf-worker.ts`, `docx.ts`, `docx-worker.ts`, `candidates.ts`, `confirm.ts`, `source.ts`, `types.ts` | pdfjs 텍스트·mammoth Word 텍스트(worker thread·시간/메모리 한도, docx는 업로드 시 ZIP 구조·크기 검사), 규칙 후보, 근거·문장 범위 검증·hash, code point 위치 |
| 화면 | `apps/web/src/resume/` | `SessionGate`, `StartPage`(U01), `ReviewPage`·`FactEditor`·`FactBulkBar`·`SourcePanel`·`WarningsPanel`(U02), `bulk.ts`(일괄 포함/제외·원문 줄 묶음 추가, 순수 함수), `api.ts` |

## S02 경력 기반 mock 검색 코드 (2026-11-17 구현)

| 책임 | 경로 | 내용 |
| --- | --- | --- |
| 검색 계획·조건·판정(순수 로직, 웹 공용) | `packages/search/src/intent.ts`, `conditions.ts`, `privacy.ts`, `job-attributes.ts`, `match.ts`, `types.ts` | 직무·기술 사실→질의, 조건 검증, 개인정보 패턴, 공고 근무 조건 파싱, 추천 이유·확인할 조건 |
| 검색 provider 경계·mock | `packages/search/src/provider.ts`, `mock-catalog.ts` | `SearchProvider` interface·`SearchProviderError.transmission`, 합성 공고 10개(.invalid) mock. live는 아래 S03 |
| API handler | `apps/api/src/search/handlers.ts`, `repository.ts` | search-intents 생성·조회, resume-searches 생성·조회, product-tasks 취소, job-snapshots 조회 |
| worker | `apps/worker/src/search-task.ts`, `main.ts` | claim·lease·heartbeat·dispatched 기록·결과 CAS·취소·시도 상한 |
| 화면 | `apps/web/src/search/` | `SearchSetupPage`·`ConditionForm`(조건 입력), `SearchResultsPage`·`JobCard`(결과·상세 비교), `recent.ts`(최근 검색 localStorage) |

## S03 Liner live 웹 검색 코드 (2026-11-18 구현, 실호출 검증 전)

| 책임 | 경로 | 내용 |
| --- | --- | --- |
| live provider·결과 변환 | `packages/liner/src/web-search.ts` | Liner Search API 요청(질의 최대 2개, 20초 제한), 상태 코드 분류, 공고 페이지 판정·중복 제거·회사명 규칙, JobDraft(`data_origin=live`) |
| 호출 원장 | `apps/worker/src/liner-ledger.ts` | `ce7_provider_calls` 예약(lease·호출 수·예산 확인)·dispatched·정산, 사용량 집계 |
| worker 연결 | `apps/worker/src/main.ts`, `search-task.ts`, `discover-task.ts` | 설정 모드로 provider 선택, 작업 ID·lease generation을 provider에 전달, 실패 전송 상태 기록 |
| 화면 | `apps/web/src/search/SearchResultsPage.tsx`, `JobCard.tsx` | 'Liner 웹 검색 결과'·출처 링크·검색 요약만 확인·조건 '확인 필요', Liner 오류 안내 |
| 검사·실호출 확인 | `tests/liner-live.test.mjs`, `scripts/liner-live-check.mjs` | 가짜 fetch·합성 응답 검사, 유료 실호출 확인 스크립트(한도·키 존재 여부만 출력) |

## S04 대화형 맞춤 편집·PDF 코드 (2026-11-17 구현)

| 책임 | 경로 | 내용 |
| --- | --- | --- |
| 블록·변경 적용·근거 검사(순수 로직, 웹 공용) | `packages/tailor/src/blocks.ts`, `guard.ts`, `types.ts` | 기본 이력서, replace/insert/remove/reorder 적용, 숫자·기술명·책임 범위 근거 검사 |
| 대화 provider 경계·mock | `packages/tailor/src/provider.ts` | `ChatProvider` interface, 결정적 mock(정상·질문·진술·실패·지연) |
| PDF 렌더러 | `packages/render/src/resume-pdf.ts`, `packages/render/fonts/` | pdf-lib + 나눔고딕 전체 임베딩, 줄바꿈·페이지 넘김·결정적 출력. 글꼴 라이선스 `fonts/OFL.txt` |
| API handler | `apps/api/src/tailor/sessions.ts`, `proposals.ts`, `revisions.ts`, `repository.ts` | 세션·메시지·재시도·되돌리기, 제안 수용(부분)·거절, revision 조회·확정, PDF 요청·메타·파일 제공 |
| 대화 진술 근거 확정 | `packages/resume/src/confirm.ts`, `apps/api/src/resume/review.ts` | `user_statement` 근거(같은 workspace의 user 메시지, 서버 확인 시각) |
| worker | `apps/worker/src/lease.ts`, `tailor-task.ts`, `render-task.ts` | 공용 lease·heartbeat·CAS, 대화 응답·제안 저장(선별·stale), PDF 생성·hash 저장 |
| 화면 | `apps/web/src/tailor/` | `TailorPage`(U04 3분할·탭), `ChatPanel`(JD 점검 버튼·진행 패널·턴 요약), `JdCheckView`(요구사항 점검표·뺀 수정안, S1-18), `ProposalCard`, `ResumePreview`, `FinalPage`(U05 확정·PDF), `data.ts` |
| 검사 | `tests/tailor-unit.test.mjs`, `tests/tailoring-flow.test.mjs`, `tests/helpers/s04-harness.mjs`, `tests/helpers/pdf-glyphs.mjs` | 단위·HTTP+worker 통합, PDF 글리프 윤곽선 검사 |

## S05 브라우저 지원·제출 이력 코드 (2026-11-18 구현)

| 책임 | 경로 | 내용 |
| --- | --- | --- |
| migration | `contracts/v0.7/migrations/008_browser_apply.sql`, `packages/db/src/index.ts` | v0.7.1: 기기 연결·폼 관측·실행 토큰·외부 지원 기록·자체 폼 사이트 접수 저장소 |
| migration (DOCX) | `contracts/v0.7/migrations/009_docx_intake.sql` | v0.7.2: `ce7_documents` 형식 CHECK에 docx 추가(표 재생성·행/FK/트리거 유지) |
| DOCX 합성 fixture | `scripts/make-docx-fixture.mjs`, `fixtures/resumes/frontend.synthetic.docx`, `docx.synthetic.json` | 결정적 bytes 재생성, 합성 hash 목록 |
| 순수 로직 | `packages/apply/src/self-form.ts`, `payload.ts`, `verify.ts`, `types.ts` | 자체 폼 adapter 명세(문항·주소), 답변 검증·payload hash, 폼 snapshot·readback 대조 |
| 지원 API | `apps/api/src/apply/applications.ts`, `submission.ts`, `external.ts`, `devices.ts`, `repository.ts` | 지원 건·revision·이력·채용 단계, 수동 권한·시도·접수 확인 요청·근거, 외부 지원 기록, 기기 연결 코드·해제 |
| 실행기 프로토콜 | `apps/api/src/apply/executor.ts`, `docs/EXECUTOR_PROTOCOL.md` | 기기 토큰 인증, 준비·파일·관측·claim·dispatch·결과 보고 |
| 접수 대조 | `apps/api/src/apply/reconcile.ts` | 자체 폼 사이트 저장소 대조·봉인, 근거 기록(자체 폼 전용 강한 보장) |
| 자체 폼 사이트 | `apps/api/src/demo-site/site.ts`, `routes.ts`, `apps/web/src/demo/SelfFormPage.tsx` | 합성 공고 지원 폼·접수 키 중복 방지·접수번호, 개발 검증 표식([demo:slow/drop/reject]) |
| worker | `apps/worker/src/observe-task.ts` | 접수 결과 확인 작업(조회만), 보고 없는 전송 정리 |
| Chrome 확장 | `apps/extension/executor.mjs`(실행 채널), `self-form-adapter.mjs`(사이트 adapter 페이지 함수), `guard.mjs`, `service-worker.js`, `sidepanel.*` | 기기 연결, 폼 확인·입력·첨부·readback, 승인 시도 실행·결과 관측, 재시작 후 관측 재개 |
| 화면 | `apps/web/src/apply/` | `ApplicationsPage`(U07 지원 이력·외부 기록·확장 연결), `ApplicationPage`(U06 답변→폼 확인→승인→접수 결과→채용 단계), `AttemptRecord`(제출 당시 자료), `ApplyEntry`(최종 제출본에서 진입) |
| 검사 | `tests/browser-apply.test.mjs`, `tests/apply-unit.test.mjs`, `tests/helpers/s05-harness.mjs`, `apps/extension/guard.test.mjs`, `scripts/chrome-apply-e2e.mjs`(+`scripts/lib/cdp.mjs`) | 단위·HTTP 통합(확장 역할), 실제 Chrome(임시 프로필) 검증 |

## S06 유사 공고·자동 준비 코드 (2026-11-18 구현)

| 책임 | 경로 | 내용 |
| --- | --- | --- |
| 유사도·문서 점검(순수 로직) | `packages/apply/src/similarity.ts` | 직무 계열·책임 수준·공통 기술·업무 표현 점수와 설명, 확정 파일 재사용 점검(기준 회사명·전용 문구) |
| 정책 API | `apps/api/src/automation/policies.ts` | revision 작성(recommend·prepare), 조회, 활성화(content hash·generation·동의)·일시중지·철회 |
| 캠페인 API | `apps/api/src/automation/campaigns.ts` | 기준 고정 생성, 실행(discover_similar 예약)·일시중지·종료, 대기함 |
| worker | `apps/worker/src/discover-task.ts` | 탐색 → 조건·중복·사이트·문항 판정 → 서류(고정 PDF 점검 또는 사실 범위 맞춤+PDF) → 자동 준비 지원 건(제출 없음) |
| 화면 | `apps/web/src/automation/` | `CampaignSetupPage`(U08 기준·모드·조건·한도·동의), `CampaignPage`(U09 대기함) |
| 검사·시연 | `tests/similar-jobs.test.mjs`, `tests/helpers/s06-harness.mjs`, `scripts/demo-seed.mjs`, `scripts/demo.mjs` | 단위·HTTP+worker 통합, 시연 데이터 준비(기본 제출 직전 멈춤), 새 임시 DB 시연 실행(`docs/DEMO_RUNBOOK.md`) |

## 신규 기능과 현재 기준 문서

| 신규 기능 | 우선 읽을 문서 | 구현 시 연결할 영역 |
| --- | --- | --- |
| 원본 등록·추출·확정 경력 | `PRODUCT_SPEC.md`, `UI_UX.md`, `../contracts/v0.7/README.md` | API, 파일 저장, domain, web |
| 경력 기반 검색 | `../prompts/01-resume-search.md`, `ARCHITECTURE.md` | API task, worker, Liner, web |
| 대화형 수정·diff·PDF | `../prompts/02-chat-resume.md`, `UI_UX.md` | 대화 provider, revision 서비스, 렌더 파일 |
| 제출 권한·브라우저·이력 | `BROWSER_ADAPTERS.md`, `../prompts/03-browser-history.md` | extension, API, 사이트 adapter, history |
| 유사 공고·자동 준비 | `../prompts/04-similar-jobs.md` | seed campaign, 조건·중복 검사, 준비 queue |
| 조건부 자동 제출 | `../prompts/05-auto-apply.md` | 정책·한도 예약·공고별 authorization·dispatch |
| DB·HTTP 구조 | `../contracts/v0.7/README.md` | ce7_* 추가 migration과 /api/v1 리소스 |
| 인수 검증 | `ACCEPTANCE.md`, `reports/VALIDATION.md` | 단계별 서비스·브라우저 테스트 |

## 아직 구현되지 않은 것

제품 대화 모델(live) provider, live 검색 provider의 실호출 검증(S03 코드는 있음), 외부 채용사이트 adapter·Ego 실행 채널, 운영 로그인, 정책 기반 자동 제출·한도 예약(S07)은 아직 구현 대상이다. 계약 스키마가 존재한다는 사실과 코드 존재를 구분한다.

기능별 새 파일 이름은 구현 시 현재 코드 규모와 책임에 맞게 정한다. 존재하지 않는 파일을 이미 있는 코드처럼 링크하지 않고, 생성 후 이 표에 실제 경로와 검증을 등록한다.

## 현재 1인 개발 자료 v0.9

| 목적 | 경로 |
| --- | --- |
| 1인 개발 흐름과 완료 기준 | `SOLO_DEVELOPMENT.md` |
| 현재 작업 목록과 초기 상태 | `solo/TASKBOARD.md`, `solo/tasks.json` |
| 첫 개발 지시 | `../prompts/solo-start.md`, `../prompts/00-start.md` |
| 이어가기·검토 | `../prompts/resume.md`, `../prompts/review.md` |
| 과거 2인 협의 자료 | `archive/v0.8-team/` |

실제 앱·API·DB 코드는 위의 v0.7 진입점과 동일하다. 자료 추가만으로 미구현 기능을 코드맵의 구현 완료로 표시하지 않는다.

| 대화 provider(Liner live, S4-14) | `packages/liner/src/chat.ts`, `apps/worker/src/main.ts`, `apps/api/src/config.ts`(CHAT_MODE), `scripts/liner-chat-check.mjs`, `apps/web/src/tailor/chatMode.ts` | Router API 요청·예약/정산·연락처 가림·가격표, 실호출 확인 스크립트, 화면 전송 안내 |
| 안티슬롭(S4-13) | `packages/tailor/src/slop.ts`, `packages/tailor/src/screen-changes.ts`(`screenChanges`·`guardReason`, worker `tailor-task.ts`가 재수출), `packages/tailor/src/user-sentence.ts` | AI 제안 문장 상투·과장 표현 제외, 사실 확인 후보 원문 문장 보정 |
| 1차 점검(규칙, S1-13)·문장 패턴(S4-15) | `packages/tailor/src/review.ts`, `packages/tailor/src/patterns.ts`, `apps/web/src/search/ReviewPanel.tsx` | 검색 전 보완 안내·질문, 직무별 원칙·합성 예시(대화 지시문에도 사용) |
| AI 1차 점검(S1-14) | `contracts/v0.7/migrations/010_resume_review.sql`, `apps/api/src/resume/ai-review.ts`, `apps/worker/src/review-task.ts`, `packages/tailor/src/review-provider.ts`, `packages/liner/src/review.ts`, `apps/web/src/search/AiReviewSection.tsx` | 요청·조회 API, worker, mock/Liner provider·결과 거르기, 화면 버튼·결과 |
| 기본 이력서 보완 대화(S1-16) | `contracts/v0.7/migrations/011_resume_supplement.sql`, `apps/api/src/resume/supplement.ts`, `apps/worker/src/supplement-task.ts`, `packages/tailor/src/supplement.ts`(턴 거르기·mock), `packages/tailor/src/user-sentence.ts`(사용자 문장 판정, 맞춤 대화와 공유), `packages/liner/src/supplement.ts`, `apps/web/src/resume/SupplementSection.tsx`·`SupplementTurnView.tsx`, `tests/supplement.test.mjs` | 확정 경력 점검·질문 → 사용자 답변 문장만 경력 후보 → 기존 확정 API로 새 버전(user_statement 근거) |
| 보완 대화 오케스트레이션·진행 표시(S1-17) | `packages/tailor/src/supplement-pipeline.ts`(단계 실행·진행 기록·닫힌 쪽 실패), `packages/tailor/src/supplement.ts`(단계별 거르기·mock 단계), `packages/liner/src/supplement.ts`(AI 점검·근거 검토 요청), `apps/worker/src/supplement-task.ts`(진행 저장), `contracts/v0.7/migrations/012_supplement_progress.sql`, `apps/web/src/resume/AgentProgress.tsx`·`progress.ts`(진행 패널), `apps/web/src/resume/similar.ts`(기존 항목 바꾸기), `packages/tailor/src/supplement-eval.ts`·`scripts/supplement-eval.mjs`·`fixtures/eval/supplement/`(비교 평가), `tests/supplement-pipeline.test.mjs` |
| 공고(JD) 맞춤 점검·수정 오케스트레이션(S1-18) | `packages/tailor/src/tailor-pipeline.ts`(요구사항 대조 → AI 점검 / 수정안 작성 → 근거 검토, 닫힌 쪽 실패), `packages/tailor/src/jd-check.ts`(`checkRequirements`·`screenJdReview`·mock 단계 provider), `packages/tailor/src/stage-tracker.ts`(보완 대화와 공용 단계 기록기), `packages/liner/src/tailor-stages.ts`(Liner AI 점검·근거 검토 요청), `apps/worker/src/tailor-task.ts`(JD 점검·답변 턴 실행, 진행 기록·턴 결과 저장), `apps/api/src/tailor/sessions.ts`(`requestJdCheck`), `apps/web/src/tailor/JdCheckView.tsx`·`ChatPanel.tsx`, `apps/web/src/resume/progress.ts`(`TAILOR_PROGRESS`), `contracts/v0.7/migrations/013_tailoring_progress.sql`, `tests/tailor-pipeline.test.mjs` | JD 요구사항 점검표·질문, 수정안 근거 검토, 진행 패널 |
