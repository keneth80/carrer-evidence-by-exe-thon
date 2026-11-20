# v0.7 API 작업 목록

**S01 구현 상태 (2026-11-17):** 아래 표의 `product-session`, `resume-documents`(등록·붙여넣기·목록·조회·원문·원본·추출 초안), `fact-revisions`(확정), `resume-fact-revisions`(조회), `product-tasks/{task_id}`(조회)는 로컬 개발 세션에서 handler가 구현되어 있다. 나머지 경로는 여전히 501이다. 개발 전용 `POST/DELETE /api/v1/local-dev/session`은 제품 계약이 아니므로 OpenAPI에 넣지 않았다(요청·응답 schema: `LocalDevSessionCreate`, `LocalDevSession`). 근거: `tests/resume-intake.test.mjs`, `scripts/check_contracts.py`의 S01 응답 schema 검증.

**S02 구현 상태 (2026-11-17):** `search-intents`(생성·조회), `resume-searches`(생성 202·조회), `product-tasks/{task_id}/cancel`(search_jobs만), `job-snapshots/{job_snapshot_id}`(조회)도 handler가 구현되어 있다. 검색 실행은 `apps/worker`(mock provider)가 맡는다. 계약 변경 없음. 근거: `tests/resume-search.test.mjs`, `scripts/check_contracts.py`의 S01·S02 응답 schema 검증(21개).

**S04 구현 상태 (2026-11-17):** `tailoring-sessions`(생성·조회·메시지 작성 202·메시지 목록·제안 목록), `edit-proposals/{id}/accept`, `resume-revisions/{id}`(조회·확정), `artifacts`(렌더 요청 202·메타·PDF 내용) handler가 구현되어 있다. 대화 응답과 PDF 렌더는 `apps/worker`가 실행한다(mock 대화). 확장 경로(DECISIONS S4-09): `GET /tailoring-sessions/{id}/tasks`, `POST /edit-proposals/{id}/reject`, `POST /tailoring-sessions/{id}/messages/{message_id}/retry`, `POST /tailoring-sessions/{id}/restore`, `GET /tailoring-sessions/{id}/revisions`, `GET /resume-revisions/{id}/artifacts`, `ProposalAccept.change_indexes`. 근거: `tests/tailoring-flow.test.mjs`, `scripts/check_contracts.py`의 S01·S02·S04 응답 schema 검증(38개).

**S05 구현 상태 (2026-11-18):** `job-applications`(생성·목록·조회·수정·수동 권한·시도·채용 단계), `submission-attempts/{id}`(조회·접수 결과 확인 202), `submission-evidence/{id}`가 구현되어 있다. 확장 경로(DECISIONS S5-11): `GET /job-applications/{id}/history`, `POST /executor-pairings`, `GET /executor-devices`, `POST /executor-devices/{id}/revoke`, `POST·GET /external-applications`. 실행기 증거 전송은 공개 API가 아닌 기기 토큰 인증 내부 프로토콜(`docs/EXECUTOR_PROTOCOL.md`)이다. 현재 지원 사이트는 개발용 자체 테스트 폼뿐이며 외부 기업 접수는 구현되지 않았다. 근거: `tests/browser-apply.test.mjs`, `scripts/chrome-apply-e2e.mjs`, `scripts/check_contracts.py`(54개).

**S06 구현 상태 (2026-11-18):** `auto-apply-policies`(작성·목록·조회·revision 조회·활성화·일시중지·철회, mode는 recommend·prepare만), `similar-job-campaigns`(생성·목록·조회·실행 202·일시중지·종료)가 구현되어 있다. 확장 경로: `GET /similar-job-campaigns/{id}/queue`(DECISIONS S6-10). 정책 기반 자동 제출(submit)은 S07이다. 근거: `tests/similar-jobs.test.mjs`, `scripts/check_contracts.py`(67개).

모든 경로는 구현 전 계약이다. 현재 starter의 `/api/v1/*` 응답은 미구현이며, 아래 표는 제품 동작 완료 목록이 아니다. 정확한 요청/응답은 `openapi.yaml`과 `schemas/domain.schema.json`, 의미 검증은 `SERVICE_RULES.md`를 따른다.

| 단계 | 메서드·경로 | 작업 |
| --- | --- | --- |
| 01 이력서·검색 | `GET /api/v1/product-session` | 제품의 인증 범위·사용 가능 기능 |
| 01 이력서·검색 | `POST /api/v1/resume-documents` | 텍스트 PDF 원본 등록 |
| 01 이력서·검색 | `POST /api/v1/resume-documents/text` | 붙여넣기 원본 등록 |
| 01 이력서·검색 | `GET /api/v1/resume-documents/{document_id}` | 원본 메타데이터·추출 상태 |
| 01 이력서·검색 | `GET /api/v1/resume-documents/{document_id}/extraction` | 확인 전 추출 초안 |
| 01 이력서·검색 | `POST /api/v1/resume-documents/{document_id}/fact-revisions` | 사용자가 확인한 경력 revision 생성 |
| 01 이력서·검색 | `GET /api/v1/resume-fact-revisions/{revision_id}` | 확정 경력 조회 |
| 01 이력서·검색 | `POST /api/v1/resume-fact-revisions/{revision_id}/ai-reviews` | AI 1차 점검 요청(v0.7.3, 구현: mock·Liner) |
| 01 이력서·검색 | `GET /api/v1/resume-ai-reviews/{review_id}` | AI 1차 점검 결과 조회(v0.7.3, 구현) |
| 01 이력서·검색 | `POST /api/v1/resume-fact-revisions/{revision_id}/supplement-sessions` | 기본 이력서 보완 대화 시작(v0.7.4, 구현: mock·Liner) |
| 01 이력서·검색 | `GET /api/v1/resume-supplement-sessions/{session_id}` | 보완 대화·에이전트 턴 조회(v0.7.4, 구현) · 단계별 진행 기록 `progress`·턴 요약 `pipeline`(v0.7.5, 구현) |
| 01 이력서·검색 | `POST /api/v1/resume-supplement-sessions/{session_id}/messages` | 보완 대화에 답하기(v0.7.4, 구현) |
| 01 이력서·검색 | `POST /api/v1/resume-supplement-sessions/{session_id}/suggestions` | 점검 항목별 추천 문장 작업(작성 → 근거 검토, v0.7.8, 구현) |
| 01 이력서·검색 | `POST /api/v1/resume-supplement-sessions/{session_id}/statements` | 고른·직접 쓴 문장을 내 진술로 기록(모델 없음, v0.7.8, 구현) |
| 01 이력서·검색 | `GET /api/v1/resume-documents` | 내 원본 목록·확정 경력 head (S01 추가) |
| 01 이력서·검색 | `GET /api/v1/resume-documents/{document_id}/source-text` | 근거 위치 기준 원문 텍스트 (S01 추가) |
| 01 이력서·검색 | `GET /api/v1/resume-documents/{document_id}/original` | 원본 파일 bytes 재열람 (S01 추가) |
| 01 이력서·검색 | `POST /api/v1/search-intents` | 확정 경력과 조건에서 검색 계획 생성 |
| 01 이력서·검색 | `GET /api/v1/search-intents/{intent_id}` | 검색 계획 조회 |
| 01 이력서·검색 | `POST /api/v1/resume-searches` | 이력서 기반 검색 작업 생성 |
| 01 이력서·검색 | `GET /api/v1/resume-searches/{search_id}` | 검색 상태와 공고 ID 조회 |
| 01 이력서·검색 | `GET /api/v1/product-tasks/{task_id}` | 영속 task 조회 |
| 01 이력서·검색 | `POST /api/v1/product-tasks/{task_id}/cancel` | 새 실행 중지 요청 |
| 01 이력서·검색 | `GET /api/v1/job-snapshots/{job_snapshot_id}` | 검색 당시 공고·근거 조회 |
| 02 대화·PDF | `POST /api/v1/tailoring-sessions` | 공고별 대화형 이력서 편집 시작 |
| 02 대화·PDF | `GET /api/v1/tailoring-sessions/{session_id}` | 편집 상태 조회 · 단계별 진행 기록 `progress`(v0.7.6, 구현) |
| 02 대화·PDF | `POST /api/v1/tailoring-sessions/{session_id}/messages` | 대화 입력과 수정 제안 작업 · v0.7.6부터 수정안 작성 → 근거 검토 |
| 02 대화·PDF | `POST /api/v1/tailoring-sessions/{session_id}/jd-checks` | 공고(JD) 맞춤 점검 요청: 요구사항 대조 → AI 점검(v0.7.6, 구현: mock·Liner) |
| 02 대화·PDF | `GET /api/v1/tailoring-sessions/{session_id}/messages` | 대화 조회 · assistant 턴 결과 `turn`(v0.7.6, 구현) |
| 02 대화·PDF | `GET /api/v1/tailoring-sessions/{session_id}/proposals` | 변경 비교·확인 질문 조회 |
| 02 대화·PDF | `POST /api/v1/edit-proposals/{proposal_id}/accept` | 검토한 변경 제안 적용 |
| 02 대화·PDF | `GET /api/v1/resume-revisions/{revision_id}` | 공고별 이력서 버전 조회 |
| 02 대화·PDF | `POST /api/v1/resume-revisions/{revision_id}/finalize` | 직접 확인한 제출 문서 확정 |
| 02 대화·PDF | `POST /api/v1/artifacts` | 확정 이력서를 PDF로 렌더링 |
| 02 대화·PDF | `GET /api/v1/artifacts/{artifact_id}` | 제출 파일 메타데이터 |
| 02 대화·PDF | `GET /api/v1/artifacts/{artifact_id}/content` | 소유 범위 검증 후 실제 PDF 제공 |
| 03 지원·이력 | `POST /api/v1/job-applications` | 공고별 지원 초안 생성 |
| 03 지원·이력 | `GET /api/v1/job-applications` | 지원 이력 목록 |
| 03 지원·이력 | `GET /api/v1/job-applications/{application_id}` | 제출 버전·지원 이력 |
| 03 지원·이력 | `PATCH /api/v1/job-applications/{application_id}` | 새 지원 내용 revision 저장 |
| 03 지원·이력 | `POST /api/v1/job-applications/{application_id}/manual-authorizations` | 해당 공고·최종 파일·답변·폼 승인 |
| 03 지원·이력 | `POST /api/v1/job-applications/{application_id}/attempts` | 지원 실행 시도 예약 |
| 03 지원·이력 | `GET /api/v1/submission-attempts/{attempt_id}` | 지원 결과·불명 상태 조회 |
| 03 지원·이력 | `POST /api/v1/submission-attempts/{attempt_id}/observe` | 외부 접수 결과 재확인 |
| 03 지원·이력 | `GET /api/v1/submission-evidence/{evidence_id}` | 접수 판단 근거 조회 |
| 03 지원·이력 | `POST /api/v1/job-applications/{application_id}/recruitment-events` | 채용 진행 단계 기록 |
| 04~05 자동화 | `POST /api/v1/auto-apply-policies` | 자동화 정책 revision 작성 |
| 04~05 자동화 | `GET /api/v1/auto-apply-policies` | 정책별 최신 설정 목록 |
| 04~05 자동화 | `GET /api/v1/auto-apply-policies/{policy_id}/revisions/{revision_id}` | 정책의 불변 설정 조회 |
| 04~05 자동화 | `POST /api/v1/auto-apply-policies/{policy_id}/activate` | 정확한 정책 내용으로 자동화 활성화 |
| 04~05 자동화 | `POST /api/v1/auto-apply-policies/{policy_id}/pause` | 정책의 새 전송 중지 |
| 04~05 자동화 | `POST /api/v1/similar-job-campaigns` | 고정 기준의 유사 공고 캠페인 |
| 04~05 자동화 | `GET /api/v1/similar-job-campaigns` | 유사 공고 캠페인 목록 |
| 04~05 자동화 | `GET /api/v1/similar-job-campaigns/{campaign_id}` | 유사 공고 자동화 진행 조회 |
| 04~05 자동화 | `POST /api/v1/similar-job-campaigns/{campaign_id}/run` | 정책 모드에 따른 탐색·준비 작업 |
| 04~05 자동화 | `GET /api/v1/auto-apply-policies/{policy_id}` | 현재 활성 정책·상태·generation 조회 |
| 04~05 자동화 | `POST /api/v1/auto-apply-policies/{policy_id}/revoke` | 정책 실행 권한 철회 |
| 04~05 자동화 | `POST /api/v1/similar-job-campaigns/{campaign_id}/pause` | 선택한 캠페인의 새 전송 중지 |
| 04~05 자동화 | `POST /api/v1/similar-job-campaigns/{campaign_id}/cancel` | 캠페인 종료와 대기 작업 취소 |

쓰기 요청의 Idempotency-Key는 같은 동작의 중복 효과를 막는다. 원격 사이트의 전송까지 exactly-once로 보장한다는 뜻은 아니다. `observe`는 조회 작업이며 재제출이 아니다. 목록 응답의 next_cursor는 해당 GET의 cursor 파라미터로 전달하며, scope와 정렬 기준에 결속한다.

정책 권한 발행과 executor의 증거 전송은 인증된 내부 실행 프로토콜로 구현한다. 웹 클라이언트가 임의의 `kind=policy` 권한이나 접수 성공 증거를 만들어 INSERT하는 공개 API는 제공하지 않는다.
