# v0.7 데이터 매핑과 전환 규칙

## 1. 저장 경계

v0.4의 원본 17개 제품 테이블과 metadata를 보존한다. v0.7은 `ce7_*` 29개 테이블을 추가한다. v0.4의 `files.is_synthetic=1`, `applications.target_id=career-evidence-demo-v1`를 풀어서 실제 사용자 흐름에 쓰는 방식은 사용하지 않는다. 이전 demo의 context/profile/application과 새 제품의 경력/지원 revision은 서로 다른 데이터 모델이다.

기존 소스·사실·판단 구분, 작업 lease/CAS, request idempotency, 파일 hash 검증 원리는 재사용한다. 불변 v0.4 테이블을 실사용 내용으로 다시 쓰거나 worker의 새 kind를 기존 CHECK 밖으로 억지로 INSERT하지 않는다.

## 2. 공개 모델 → 저장 구조

공개 날짜는 RFC3339 UTC, DB `*_at_ms`는 UTC epoch milliseconds다. 화면 날짜와 일일 한도 경계만 Asia/Seoul로 변환한다. hash는 SHA-256 소문자 64자리다. 문자열 길이 검사만으로 실제 bytes hash의 정확성이 보장되지는 않는다.

| 공개 모델/의미 | 저장 테이블·열 | 주요 관계 |
| --- | --- | --- |
| 인증된 사용자 | `ce7_principals` | 검증된 auth subject, authenticated/synthetic_local 구분 |
| workspace 소유권 | `ce7_workspace_owners` | stable principal→workspace 연결. 클라이언트 지정 불가 |
| ResumeDocument | `ce7_documents` | 원본 object_key·bytes hash·추출 상태·현재 fact revision |
| ExtractionDraft | `ce7_extractions` | 원본 hash에 연결된 확인 전 초안·경고 |
| ResumeFactRevision | `ce7_fact_revisions` | 문서별 revision·부모·확정 사실 JSON·confirmed_at |
| SearchIntent | `ce7_search_intents` | 확정 fact revision, 조건, 근거 ID가 연결된 queries |
| Task | `ce7_tasks` | kind/state/input/results·취소 요청·lease generation·전송 상태 |
| SearchRun | `ce7_search_runs` | intent·task·provider mode·결과 상태 |
| 검색 결과 순서 | `ce7_search_results` | 회차별 slot 1~10, 공고 snapshot 연결 |
| JobSnapshot | `ce7_job_snapshots` | canonical job_key·원문·요구사항·관찰 시각·hash |
| TailoringSession | `ce7_tailoring_sessions` | 공고·현재 fact revision·현재 resume revision·CAS revision |
| TailoringMessage | `ce7_messages` | 사용자/AI 발화·생성 기반 resume revision |
| EditProposal | `ce7_edit_proposals` | base revision/hash·변경안·미해결 질문·수용 상태 |
| ResumeRevision | `ce7_resume_revisions` | 블록별 사실 ID, parent revision·공고·경력 버전·확정 metadata |
| RenderedArtifact | `ce7_artifacts` | 실제 PDF object_key·byte_size·sha256, final resume 참조 |
| 브라우저 계정 식별 | `ce7_account_bindings` | 사이트·executor·확인된 계정 fingerprint·철회 시각 |
| Application | `ce7_applications` | workspace+job_key 유일, 현재 revision, 직접/캠페인 출처 |
| ApplicationRevision | `ce7_application_revisions` | 공고·이력서·실제 파일 hash·질문 답변·전체 payload hash |
| AutoApplyPolicyRevision | `ce7_policy_revisions` | 변경 불가능한 조건·허용 범위·한도·기간·문서 전략 |
| PolicyControl | `ce7_policy_controls` | 활성 revision·state·generation. 설정 내용과 실행 제어 분리 |
| SimilarJobCampaign | `ce7_campaigns` | 기준 지원 revision·공고·이력서 고정, 활성/중지 상태 |
| 캠페인의 발견·준비 결과 | `ce7_campaign_jobs` | 유사 근거·적격 판단 상태·지원 건 연결 |
| ApplicationAuthorization | `ce7_authorizations` | manual/policy를 구분한 공고별 일회성 권한 |
| SubmissionAttempt | `ce7_attempts` | 전송 시작과 접수 불명 상태까지 영속 보존 |
| SubmissionEvidence | `ce7_submission_evidence` | 접수/미접수 판단 근거·종류·관찰 시각 |
| 자동 지원 횟수·비용 예약 | `ce7_quota_reservations` | policy_id·업무일·attempt, reserved/consumed/released |
| 채용 단계 이벤트 | `ce7_recruitment_events` | 지원 접수와 분리한 단계·출처·시각·메모 |
| 요청 중복 방지 | `ce7_request_keys` | workspace·operation·key, 실제 path/body fingerprint |
| 외부 AI 호출 이력 | `ce7_provider_calls` | provider/purpose·전송 상태·예약/확인 비용·lease generation |

`Application.submission_state`는 현재 revision의 준비 상태와 attempt/evidence에서 서버가 산출한다. `Application.recruitment_stage`는 최신 유효 채용 event가 없으면 unknown이다. API가 읽기 작업 중 임의로 지원·재접수를 실행하지 않는다. 작업/캠페인 목록은 관계 테이블에서 산출하며 공개 JSON 배열과 DB의 내부 JSON을 무검증으로 맞바꾸지 않는다.

### v0.7.1 추가 테이블(008_browser_apply.sql, S05)

| 테이블 | 용도 |
| --- | --- |
| `ce8_executor_devices`·`ce8_executor_pairings` | 실행기 기기(토큰 hash)와 10분 1회용 연결 코드(hash) |
| `ce8_form_observations` | 확장이 관측한 폼 snapshot·readback과 서버 대조 결과(inspected/verified/mismatch). 수동 권한의 근거 |
| `ce8_attempt_runs` | 시도별 실행 토큰 hash·dispatch·결과 보고. 전송 전 재발급만 허용 |
| `ce8_external_applications` | 사용자가 다른 경로로 지원한 기록(job_key가 있으면 같은 공고 지원 차단) |
| `demo_site_submissions` | 자체 테스트 폼 '사이트'의 접수 저장소(workspace 없음, 접수 키 유일, accepted/sealed, 갱신 불가) |

### v0.7.6 공고 맞춤 대화 단계별 진행·턴 결과(013_tailoring_progress.sql)

`ce7_tailoring_sessions.progress_json`과 `ce7_messages.result_json`(둘 다 NULL 또는 유효 JSON) 열만 더했다(`ALTER TABLE ADD COLUMN`, 표 재생성 없음, 기존 행은 NULL). `progress_json`은 worker가 단계 경계(요구사항 대조·AI 점검·수정안 작성·근거 검토)마다 lease를 확인한 짧은 transaction으로 덮어쓰며 API `TailoringSession.progress`로 나간다. `result_json`은 assistant 메시지의 턴 결과(요구사항 점검표·AI 점검 질문·단계 요약·근거 검토에서 뺀 수정안과 이유)이고 API `TailoringMessage.turn`으로 나간다. 수정안 자체는 기존처럼 `ce7_edit_proposals`에 저장한다. JD 점검 작업은 `ce7_tasks.input_json.message_id = null`인 `tailor_resume` 작업이다(DECISIONS S1-18).

### v0.7.5 보완 대화 단계별 진행 기록(012_supplement_progress.sql)

`ce8_supplement_sessions`에 `progress_json`(NULL 또는 유효 JSON) 열만 더했다(`ALTER TABLE ADD COLUMN`, 표 재생성 없음, 기존 행은 NULL). worker가 단계 경계마다 최근 턴의 진행 상태(`task_id`·`mode`·단계별 `state`·시각·메모)를 lease를 확인한 짧은 transaction으로 덮어쓴다. 식별 열 갱신 금지 trigger는 그대로다. 끝난 턴의 단계 요약은 assistant 메시지 `result_json.pipeline`에 남는다(DECISIONS S1-17). 표 수 55.

### v0.7.4 기본 이력서 보완 대화(011_resume_supplement.sql)

`ce7_tasks.kind`에 `supplement_resume`을 추가했다(010과 같은 방식으로 표 재생성, 행·FK·색인 유지). `ce8_supplement_sessions`는 시작한 확정 경력 버전에 묶인 대화(식별 열 갱신 불가), `ce8_supplement_messages`는 사용자·에이전트 메시지(에이전트 메시지는 거른 턴 결과를 result_json에, 저장 후 갱신 불가)다. 대화는 경력 사실이 아니며 사용자 메시지만 확정 API의 user_statement 근거가 된다. 표 수 55.

### v0.7.3 AI 1차 점검(010_resume_review.sql)

`ce7_tasks.kind`에 `review_resume`을 추가했다(009와 같은 방식으로 표 재생성, 행·FK·색인 유지). `ce8_resume_reviews`는 확정 경력 한 버전에 대한 점검 결과(queued→succeeded/failed, 끝나면 갱신 불가)이며 경력 사실이 아니다. 표 수 53.

### v0.7.2 형식 확장(009_docx_intake.sql, DOCX 원본)

`ce7_documents`의 `input_kind`에 `docx`, `mime_type`에 Word MIME(`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)을 추가했다. SQLite는 CHECK를 바꿀 수 없어 같은 열·키·FK·트리거로 표를 다시 만들고 기존 행을 그대로 옮긴다. 표 수(52)는 같다. 추출·확정 경력 행은 같은 id를 계속 가리킨다.

## 3. 단계별 transaction

### 원본과 확정 경력

파일 전송·검사는 쓰기 transaction 밖에서 수행하고, private object key와 실제 hash를 얻은 뒤 문서 행과 추출 task를 함께 저장한다. 업로드 중간 파일 정리는 해당 요청의 소유 범위를 확인한다. 추출 완료 후 ExtractionDraft를 저장하고 원본을 변경하지 않는다.

사용자가 내용을 확인하면 `BEGIN IMMEDIATE` → 문서 owner·current_fact_revision_id와 expected parent 확인 → 새 fact revision INSERT → 문서의 head 갱신 → request key 저장 → COMMIT. 수정 근거는 원문 페이지/문자 구간 또는 사용자가 확인한 실제 발화에 연결한다. 텍스트의 빈 구간을 경력 없음으로 확정하지 않는다.

### 검색

SearchIntent는 확정 경력과 조건의 고정 스냅샷이다. task와 search run, request key를 함께 저장한다. worker는 현재 lease owner/generation/만료와 state를 모두 CAS로 확인한 뒤 결과를 저장한다. 외부 호출은 transaction 밖이며 전송 불명 호출은 새 유료 호출로 자동 반복하지 않는다.

### 대화형 편집

대화 입력과 task는 먼저 저장한다. EditProposal의 base revision/hash가 현재 화면과 일치할 때만 적용한다. 확인되지 않은 사실 추가가 있으면 사용자에게 질문한다. 변경 수용은 새 ResumeRevision과 session head를 같은 transaction에서 기록한다. 최종 확정은 내용 자체를 바꾸지 않는 일회성 metadata 전환이다. final 상태가 된 뒤에는 새 revision으로만 수정한다.

### 지원 초안·권한

`ce7_applications(current_revision=NULL)` → revision 1 → head=1 순서로 만든다. 이후에는 이전 payload를 수정하지 않고 새 revision을 INSERT한다. active/unknown/submitted attempt가 있는 지원 건의 head를 바꿀 수 없다. prepared 작업을 수정하려면 먼저 실제 전송이 시작되지 않았음을 확인하여 해당 시도를 닫는다.

수동 권한은 현재 application revision, 공고, 파일 bytes hash, 답변 전체 hash, 계정, 폼 관찰 hash와 연결한다. 정책 권한은 여기에 policy revision/generation, campaign, 적격 판정 hash를 더한다. 정책 권한에 `user_reviewed_at`을 붙여 사람이 매건 확인한 것처럼 기록하지 않는다.

### 전송과 불명 상태

attempt는 prepared로만 생성된다. 같은 authorization은 한 번만 소비한다. partial unique index가 같은 application에 prepared/dispatched/submitted/submission_unknown 상태의 시도를 두 개 만들지 못하게 한다. 이 제약은 Chrome과 Ego가 공유한다.

실행 직전 서버는 현재 권한·계정·폼·정책·한도를 재확인한다. 정책 지원은 같은 transaction에서 횟수/비용 예약과 전송 의도를 영속 저장한다. browser 명령을 보내기 전 `dispatched` 경계를 먼저 저장한다. transaction 이후 응답 유실/프로세스 종료는 실제 전송 여부를 확정할 수 없으므로 submission_unknown으로 남길 수 있다. DB transaction은 외부 사이트의 접수 transaction을 묶을 수 없다.

접수 증거를 INSERT한 뒤 submitted로 바꾼다. 전송 이후 not_submitted로 종결하려면 권위 있는 no_delivery_proof가 필요하다. 화면을 찾지 못했거나 네트워크가 끊긴 것은 그 증거가 아니다. 외부 ATS가 미접수 확인을 제공하지 않으면 불명 상태가 계속 남을 수 있다.

### 한도·중지

`policy_id` 단위로 기존 reserved/consumed를 세어 revision 변경으로 사용 이력이 사라지지 않게 한다. 일일 집계는 Asia/Seoul의 실제 전송 예정일을 사용한다. 날짜 경계를 넘긴 대기 예약은 전송 전에 재계산한다. 현재 SQL의 문자열 날짜 검사는 날짜의 진실성을 검증하지 않으므로 서비스가 이 조건을 처리해야 한다.

reserved와 consumed 모두 한도에 포함한다. 전송 시작 전 실패가 입증된 경우에만 reserved를 released로 바꿀 수 있다. 전송 불명이나 전송 후 미접수 확인은 이미 시도한 횟수의 자동 환불 사유가 아니다. 비용 예약은 외부 AI 호출 비용 원장과 함께 합산해야 하며, 지원 예약 행만으로 전체 AI 예산이 보장된다고 보고하지 않는다.

PolicyControl 변경은 generation을 1 증가시킨다. pause와 새 dispatch는 같은 정책 제어 행의 최신 상태를 읽는 transaction으로 순서를 정한다. 이미 dispatched인 건은 pause로 되돌리지 않고 결과를 관찰한다.

## 4. migration runner에서 반드시 보완할 것

현재 DB 초기화기는 baseline SQL과 전체 객체 digest를 고정 검사한다. 새 SQL만 따로 적용하면 기존 초기화기가 거절한다. **기준 hash 확인 → v0.7 추가 SQL → metadata 버전·새 digest 갱신**을 한 transaction으로 처리하는 migration-aware runtime을 먼저 구현한다. 이 계약 디렉터리에는 실제 파일 DB를 변경하는 실행 runner가 없다.

기존 demo 데이터의 자동 승격은 없다. 실제 사용자가 올린 자료를 새로운 소유 scope와 ce7 모델에 저장한다. 기존 workspaces의 session_token_hash/expires_at은 demo 호환 필드이며 실제 사용자 인증·장기 자료 보존 정책의 근거로 사용하지 않는다. 새 인증된 principal과 stable workspace 관계를 로그인마다 재생성하지 않도록 한다.

## 5. SQL만으로 보장하지 않는 것

인증 제공자의 신원, CSRF/Origin, 파일 내용·PDF 유효성, 원문과 사실의 의미 일치, 개인정보 제거, 페이지 지시문과 에이전트 명령 분리, Liner/대화 모델 품질, 실제 사이트 허용 여부, 브라우저 계정과 입력 readback, 회사명 잔존 검사, 일일 날짜 정확성, 중복 공고 의미 판정, worker CAS, 외부 접수 및 실제 과금은 서비스/통합 검증 대상이다.

JSON은 `json_valid`만으로 공개 schema와 같아지지 않는다. 공개 요청·응답과 저장 JSON을 schema로 검증하고, 모든 참조가 같은 소유 범위·버전을 가리키는지 별도로 확인한다. 이 SQL의 정합성 검증을 제품 전체 검증으로 보고하지 않는다.
