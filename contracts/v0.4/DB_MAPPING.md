# 공개 API와 SQLite 매핑

공개 API의 ID는 불투명 문자열, 날짜는 UTC RFC3339이다. DB *_at_ms는 UTC epoch milliseconds이며 변환 과정에서 현지 시간 문자열을 저장하지 않는다. 화면에서만 Asia/Seoul로 표시한다.

| 공개 모델/필드 | DB 또는 산출 방식 |
| --- | --- |
| Context.id / workspace_revision | context_revisions.id / revision |
| Context.profile / conditions / digest | profile_json / conditions_json / content_hash |
| Task.context_id | tasks.context_revision_id |
| Task.outcome / cancel_requested | tasks.outcome / cancel_requested |
| Task.progress / phase / items | tasks.progress_json의 검증된 값. 항목 개수와 실제 완료 수를 검사 |
| Task.result_ids / retry_allowed | result_json과 작업 상태·재시도 계보에서 산출 |
| Task.billing_status / cost_estimate_micro_usd | provider_calls의 저장된 비용·상태를 집계. unknown이 있으면 확정 비용으로 표시하지 않음 |
| SearchRun.deep_company_key | search_runs.selected_company_key |
| SearchRun.task_id | 원본 search_runs.task_id와 tasks.retry_of_task_id 계보의 현재 작업. 원본 예약 ID는 불변 |
| Candidate.slot / title / search_id | candidate_slot / job_title / search_run_id |
| FactBundle.provenance / observed_at | data_origin / created_at_ms. sources별 retrieved_at은 해당 source JSON 값을 유지 |
| FactBundle.quality / normalizer_version | 저장된 자료의 adapter metadata 또는 task result_json. 자료가 없는 경우 추정하여 success로 올리지 않음 |
| Assessment.context_id / rule_version | context_revision_id / ruleset_version |
| Brief.sections / sources / quality / version | brief_snapshots.body_json의 검증된 필드. 회사 조사 fact bundle을 연결 |
| FileAsset.filename / synthetic | original_filename / is_synthetic=1 |
| Application.current | current_revision이 가리키는 application_revisions |
| Application.locked / receipt_id / active_attempt_id | received receipt 우선, 없으면 prepared attempt. 없으면 잠금 해제 |
| ApplicationRevision.content / digest | payload_json / draft_payload_hash |
| FormSession.target_origin / form_path / form_schema_version | exact_origin / exact_path / schema_version |
| Approval.payload / payload_digest / revision | approved_payload_json / approved_payload_hash / application_revision |
| Approval.revoked / consumed | revoked_at_ms / consumed_at_ms의 NULL 여부 |
| Attempt.submitted_payload | 연결된 approval의 불변 approved_payload_json |
| Attempt.closed_at / rejection_code | terminal_at_ms / rejected인 경우에만 reason_code |
| Receipt.received_at / payload_digest | accepted_at_ms / approved_payload_hash |
| Idempotency fingerprint | request_keys.request_hash = SHA256(UTF8(METHOD + LF + actual normalized path + LF + JCS(body))) |

## 생성과 수정 순서

### Context

BEGIN IMMEDIATE → workspace의 expected revision 검사 → context revision 새 행 → workspace head를 1 증가 → request_key 저장 → COMMIT. context를 INSERT한 뒤 head를 이동하며 FK가 트랜잭션 종료 시 일치해야 한다. 새 context만 생성하고 worker를 호출하지 않는다.

### Application

새 지원 건은 같은 트랜잭션에서 applications(current_revision=NULL) → revision 1 → head=1 순서다. 이후에는 현재 head의 expected revision을 검사하고 새 revision을 INSERT한 뒤 head를 한 단계 전진한다. 서버가 전체 content를 정규화하여 반환한다. head 이동 트리거는 기존 미소비 승인을 철회한다.

### Approval와 attempt

승인은 현재 head와 같은 revision에만 만든다. 그 form session은 같은 app이며 유효해야 한다. attempt는 prepared로 INSERT한다. INSERT 트리거가 해당 승인을 consumed로 바꾸고 같은 app의 나머지 미소비 승인을 철회한다. handler에서 consumed를 먼저 갱신하지 않는다. 같은 요청의 재호출은 새 INSERT 대신 request_key와 현재 리소스를 조회한다.

### Receipt와 종료

성공 접수는 test_receipts INSERT가 authority다. 트리거가 attempt를 received로 바꾸므로 received를 먼저 UPDATE하지 않는다. receipt가 없는 prepared만 rejected 또는 closed_not_accepted로 종결할 수 있다. 종료 후 원래 시도·승인·receipt는 변경하거나 삭제하지 않는다.

### Worker와 재시도

새 retry task는 같은 workspace/kind/context의 원본 또는 직전 task를 retry_of_task_id로 참조한다. 조상 계보는 변경하지 않는다. 유료 provider 호출은 준비한 lease owner/generation과 현재 DB 값이 일치할 때만 시작한다. 결과 저장 UPDATE는 `WHERE id=? AND state='running' AND lease_owner=? AND lease_generation=? AND lease_until_ms>?` 조건으로 변경 행 수 1을 확인해야 한다. SQL에 lease 열이 있다는 사실만으로 이 CAS가 구현되지는 않는다.

## 비용과 세션

workspaces.expires_at_ms로 세션 만료를 검사한다. budget_limit_micro_usd가 0이면 live 호출을 시작하지 않는다. provider_calls.estimated_cost_micro_usd와 billing_status를 네트워크 전에 저장하고, unknown 호출의 예약액을 자동 해제하지 않는다. verified_cost_micro_usd는 확인 근거를 확보한 경우에만 채운다. 전역 예산과 workspace 예산의 합계 검사는 짧은 쓰기 TX에서 수행한다.

## SQL이 보장하지 않는 것

현재 시각의 진실성, 세션·CSRF·Origin, hash가 실제 입력 bytes에서 계산됐는지, JSON 내부 ID 관계, source quote의 의미, task progress 산술, Liner 호출 결과·과금, Chrome sender 정보, 실제 파일 형식은 서비스/브라우저 통합 책임이다. SQL의 시각 비교는 handler가 넣은 시각이 올바르다는 전제가 있다.

읽기 전용 GET과 사용자가 고른 reconcile을 분리한다. 파일 해시 계산·Liner HTTP·브라우저 대기를 SQLite 쓰기 TX 안에서 수행하지 않는다. 모든 DB 연결에서 foreign_keys=ON을 확인한다.

불변 행의 DELETE는 막혀 있다. 제안된 7일 보존 후 정리는 이 migration의 API가 아니며, 활성 시도 봉인·정책 확인 후 별도 운영 절차/새 migration으로 구현한다. 테스트 데이터를 지우려고 트리거를 서비스 실행 중 임의로 제거하지 않는다.
