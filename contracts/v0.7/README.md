# Career Evidence v0.7 — 통합 제품 계약

작성·검증 기준일: **2026-11-16, Asia/Seoul**. 상태: **설계 계약과 격리 검증 자료**. API handler, worker, PDF 렌더러, 브라우저 지원 서비스가 완성됐다는 뜻이 아니다.

**2026-11-19 공고(JD) 맞춤 점검·수정 단계별 처리 반영(v0.7.6):** migration `013_tailoring_progress.sql`로 `ce7_tailoring_sessions.progress_json`·`ce7_messages.result_json` 열 추가(표 재생성 없음). 경로 `requestJdCheck`(`POST /api/v1/tailoring-sessions/{session_id}/jd-checks`), schema `JdCheckCreate`·`TailoringProgress`·`TailoringProgressStage`·`TailoringStage`·`TailoringPipeline`·`TailoringTurn`·`TailoringRequirementCheck`·`TailoringJdFinding` 추가, `TailoringSession.progress`·`TailoringMessage.turn`(선택 필드) 추가. 요구사항 대조 → AI 점검 / 수정안 작성 → 근거 검토(DECISIONS S1-18).

**2026-11-19 보완 대화 단계별 처리 반영(v0.7.5):** migration `012_supplement_progress.sql`로 `ce8_supplement_sessions.progress_json` 열 추가(표 재생성 없음). `ResumeSupplementSession.progress`(schema `ResumeSupplementProgress`·`ResumeSupplementProgressStage`)와 `ResumeSupplementTurn.pipeline`(schema `ResumeSupplementPipeline`·`ResumeSupplementStage`) 추가. 규칙 점검 → AI 점검 / 초안 작성 → 근거 검토(DECISIONS S1-17).

**2026-11-19 기본 이력서 보완 대화 반영:** 경로 3개(`createResumeSupplementSession`, `getResumeSupplementSession`, `postResumeSupplementMessage`)·schema 7개(`ResumeSupplementSessionRequest`, `ResumeSupplementMessageRequest`, `ResumeSupplementSession`, `ResumeSupplementMessage`, `ResumeSupplementTurn`, `ResumeSupplementCandidate`, `ResumeSupplementDraft`)·`Task.kind`에 `supplement_resume` 추가. migration `011_resume_supplement.sql`(v0.7.4)로 `ce7_tasks` CHECK 확장(표 재생성)과 대화 표 2개(DECISIONS S1-16). 사용자 메시지 문장만 경력 후보가 되고, 확정은 기존 확정 API로 한다.

**2026-11-19 AI 1차 점검 반영:** 경로 2개(`createResumeAiReview`, `getResumeAiReview`)·schema 3개(`ResumeAiReviewRequest`, `ResumeAiReview`, `ResumeAiReviewItem`)·`Task.kind`에 `review_resume` 추가. migration `010_resume_review.sql`(v0.7.3)로 `ce7_tasks` CHECK 확장(표 재생성)과 결과 표 `ce8_resume_reviews`(DECISIONS S1-14). 점검은 안내·질문이며 확정 경력을 바꾸지 않는다.

**2026-11-19 DOCX 원본 반영:** `uploadResumeDocument`가 Word(.docx)도 받는다. `input_kind`·`mime_type` enum에 docx를 추가하고 migration `009_docx_intake.sql`(버전 v0.7.2)로 `ce7_documents` CHECK만 넓혔다(DECISIONS S1-12). 007·008 bytes는 바꾸지 않았다.

**2026-11-18 S06 반영:** 정책(recommend·prepare)·유사 공고 캠페인 handler와 확장 경로 1개(대기함)·schema 3개(`CampaignQueue`, `CampaignQueueItem`, `CampaignEvaluation`)를 추가했다(DECISIONS S6-01~S6-11). migration 추가 없음.

**2026-11-18 S05 반영:** 지원 건·수동 권한·시도·접수 확인·근거·채용 단계 handler와 확장 경로 6개(지원 이력, 실행기 연결 코드·목록·해제, 외부 지원 기록)·schema 15개(`ApplicationHistory`, `FormObservation`, `ExecutorDevice` 등)를 추가했다(루트 DECISIONS S5-01~S5-12). 새 migration `008_browser_apply.sql`(버전 v0.7.1)을 추가했고 007 bytes는 바꾸지 않았다. 실행기 내부 프로토콜은 `docs/EXECUTOR_PROTOCOL.md`(공개 계약 아님). 자체 테스트 폼의 receipt/reconcile 보장은 외부 사이트에 적용하지 않는다.

**2026-11-17 S04 반영:** 대화형 편집·확정·PDF handler와 확장 경로 6개·schema 4개(`ResumeRestore`, `ResumeRevisionList`, `RenderedArtifactList`, `TaskList`)·`ProposalAccept.change_indexes`를 추가했다(루트 DECISIONS S4-09). migration SQL bytes는 바꾸지 않았다.

**2026-11-17 S01 반영:** `packages/db/src/index.ts`의 migration runner가 아래 전환 절차대로 `007_resume_workflow.sql`을 적용한다. S01 경로 handler만 구현되었고, S01 조회 경로 3개와 schema 정의 5개(`LocalDevSessionCreate`, `LocalDevSession`, `ResumeDocumentSummary`, `ResumeDocumentList`, `ResumeSourceText`)를 추가했다. migration SQL bytes는 바꾸지 않았다.

이 계약의 제품 흐름은 **원본 이력서 → 확인된 경력 → 이력서 기반 검색 → 공고 선택 → AI 대화·변경 비교 → 공고별 제출 파일 → 브라우저 지원·접수 근거 → 지원 이력 → 유사 공고 자동 준비·조건부 자동 제출**이다. 이전 v0.4의 합성 프로필·자체 테스트 폼 제약은 구형 demo 계약의 범위이며, 현재 제품의 전체 범위를 제한하는 규칙이 아니다.

## 파일과 우선순위

| 파일 | 역할 |
| --- | --- |
| `schemas/domain.schema.json` | 공개 객체와 요청 형식의 기준. 60개 정의 |
| `openapi.yaml` | `/api/v1` 신규 제품 경로 48개 작업. schema 파일을 직접 참조 |
| `API_INDEX.md` | 읽기 쉬운 작업 목록과 단계 연결 |
| `migrations/007_resume_workflow.sql` | v0.4 위에 추가하는 `ce7_*` 29개 테이블의 migration 후보 |
| `DB_MAPPING.md` | 공개 모델, 저장 열, 생성 순서, 기존 DB 전환 규칙 |
| `SERVICE_RULES.md` | 형식 검사가 대신할 수 없는 인증·근거·상태·정책 규칙 |
| `examples/` | 구조 검증용 합성 예제 12개. 실제 제출 파일·승인·비용 증거가 아님 |
| `tests/` · `VALIDATION.md` | schema/API 참조·DB 제약 검사와 실제 검증 범위 |

충돌 시 사용자 요구·루트 `DECISIONS.md` → 현재 제품/화면 문서 → 이 계약의 형식과 서비스 규칙 순으로 해당 의미를 확인한다. schema·OpenAPI·SQL이 같은 의미로 함께 바뀌어야 한다. v0.4 원본을 수정해 v0.7과 억지로 일치시키지 않는다.

## 구현 단계

| 단계 | 이번 계약에서 먼저 사용할 부분 |
| --- | --- |
| 01 이력서 기반 검색 | `ResumeDocument`, `ExtractionDraft`, `ResumeFactRevision`, `SearchIntent`, `Task`, `SearchRun`, `JobSnapshot`; 인증된 workspace 소유 범위 |
| 02 대화형 이력서·PDF | `TailoringSession`, `TailoringMessage`, `EditProposal`, `ResumeRevision`, `RenderedArtifact` |
| 03 브라우저·지원 이력 | `Application`, `ApplicationRevision`, 수동 `ApplicationAuthorization`, `SubmissionAttempt`, `SubmissionEvidence`, 채용 단계 event |
| 04 유사 공고·자동 준비 | `AutoApplyPolicyRevision`의 recommend/prepare 모드, `SimilarJobCampaign`의 고정 기준 |
| 05 조건부 자동 제출 | submit 정책 활성화, 공고별 policy authorization, 한도 예약, 중지·만료·불명 접수 처리 |
| 06 품질·데모 | 사용자 흐름 인수 기준, Liner 실제 품질과 브라우저 실증을 별도 증거로 확인 |

전체 schema를 먼저 읽기보다 현재 단계의 공개 모델·경로·서비스 규칙을 함께 읽는다. 단계 01에서 실제 기업 제출이나 유료 모델 연결을 먼저 완성할 필요는 없다. 두 종류의 합성 이력서 **파일이 실제 등록·추출·확인 경로를 통과하여 다른 검색 계획을 만드는지**부터 검증한다.

## 기존 starter와 함께 사용하는 방법

현재 `packages/db/src/index.ts`는 v0.4 기준 SQL과 DB 전체 객체 digest를 검사한다. `ce7_*` 테이블을 수동 추가하면 기존 digest와 달라져 기동이 거절될 수 있다. 따라서 이 SQL 파일을 작동 중인 DB에 바로 실행하는 것은 적용 절차가 아니다.

Claude Code가 단계 01에서 구현할 전환 절차는 다음과 같다.

1. 기존 DB/미커밋 변경을 확인하고, 현재 baseline·metadata·객체 digest가 기대한 버전인지 확인한다.
2. migration-aware DB 초기화 코드를 만든다. 빈 DB와 기존 v0.4 DB의 경로를 구분하고, 알 수 없는 변형 DB는 조용히 reset하지 않는다.
3. 모든 연결에서 FK를 켜고 검증한 다음, 한 쓰기 transaction에서 v0.7 추가 SQL과 metadata 버전·새 digest를 함께 반영한다. SQL 파일은 runner가 transaction을 소유하도록 `BEGIN/COMMIT`을 포함하지 않는다.
4. 실패하면 전체 rollback하고 이전 코드를 계속 지원할지 명시한다. 테스트는 임시 DB에서 수행하고 실제 자료가 있는 DB의 삭제로 대신하지 않는다.
5. 새 runtime이 v0.7 기대 객체를 검증하도록 갱신하고 버전 전환 테스트를 통과시킨다. 별도 연결/프로세스가 구형 runtime으로 계속 쓰지 않게 한다.

이 패키지 생성 과정에서는 사용자 DB migration을 적용하지 않았다. 계약 테스트가 메모리 DB에 적용한 것은 운영 적용 증거가 아니다.

## 소유 범위와 인증

`ce7_workspace_owners`는 인증된 principal을 저장 컨테이너인 `workspaces.id`에 연결한다. 요청의 `workspace_id`, 문서의 URL, 파일 hash 자체를 권한으로 사용하지 않는다. 실제 요청의 principal을 확인한 서버가 scope를 정한다.

기존 v0.4 demo session은 실제 사용자 이력서 인증을 대신하지 않는다. `synthetic_local` principal은 합성 자료 검증용이며, `data_origin=user` 파일은 `authenticated` principal이 소유한 scope에서만 저장한다. 로컬 개발의 인증 방법과 배포용 로그인 제공자는 구현 시 확정하되, 합성 fixture에서 실제 사용자 자료로 바뀔 때 이 경계를 건너뛰지 않는다. 기존 workspace의 7일 demo 세션 만료를 실제 원본·제출 이력의 자동 삭제 정책으로 사용하지 않는다.

## 검증 명령

프로젝트 루트에서 실행한다. 기존 v0.4와 같은 Python 의존성만 사용한다.

```bash
conda create -n career-evidence-contracts python=3.12 -y
conda activate career-evidence-contracts
python -m pip install -r contracts/v0.4/requirements-validation.txt
python -m unittest discover -s contracts/v0.7/tests -v
```

이미 같은 환경이 있으면 새 환경을 만들지 않고 활성화하면 된다. `tests`는 외부 API 키·사용자 이력서·로그인·브라우저를 요구하지 않는다. 형식과 DB 제약이 통과해도 서비스의 근거 추출 품질·실제 파일 생성·지원 성공이 확인된 것은 아니다.
