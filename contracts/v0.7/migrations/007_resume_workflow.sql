-- Career Evidence v0.7 additive migration CANDIDATE; not applied by the starter.
-- Requires v0.4 schema and a migration-aware runner. Do not execute against a
-- working application by hand: the current openDatabase object digest rejects
-- schema changes. Runner must verify baseline, migrate, update version/digest
-- metadata in ONE transaction, and release compatible runtime code together.
-- No BEGIN/COMMIT here: the runner owns the transaction. It must enable and
-- verify foreign_keys=ON on every connection before BEGIN IMMEDIATE.
-- All dates *_at_ms are UTC milliseconds. Public API uses RFC3339.
-- JSON contents, actual SHA-256 bytes, ownership authentication, remote effects,
-- current time, source evidence and policy eligibility require service checks.


CREATE TABLE ce7_principals (
id TEXT NOT NULL PRIMARY KEY, auth_subject TEXT NOT NULL UNIQUE, mode TEXT NOT NULL CHECK(mode IN ('authenticated','synthetic_local')), created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0)
);


CREATE TABLE ce7_workspace_owners (
workspace_id TEXT NOT NULL PRIMARY KEY, principal_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL, FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(principal_id) REFERENCES ce7_principals(id)
);


CREATE TABLE ce7_documents (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

input_kind TEXT NOT NULL CHECK(input_kind IN ('text_pdf','pasted_text')),
filename TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','text/plain')),
byte_size INTEGER NOT NULL CHECK(byte_size>0), sha256 TEXT NOT NULL CHECK(sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*')), object_key TEXT NOT NULL,
data_origin TEXT NOT NULL CHECK(data_origin IN ('user','synthetic')),
extraction_status TEXT NOT NULL CHECK(extraction_status IN ('uploaded','extracting','review_required','extracted','failed')),
error_code TEXT, current_fact_revision_id TEXT, created_at_ms INTEGER NOT NULL,
CHECK((input_kind='text_pdf' AND mime_type='application/pdf') OR (input_kind='pasted_text' AND mime_type='text/plain')),
UNIQUE(workspace_id,object_key), UNIQUE(workspace_id,id,sha256),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,current_fact_revision_id,id) REFERENCES ce7_fact_revisions(workspace_id,id,document_id) DEFERRABLE INITIALLY DEFERRED
);


CREATE TABLE ce7_extractions (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

document_id TEXT NOT NULL, source_sha256 TEXT NOT NULL CHECK(source_sha256 IS NULL OR (length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*')), state TEXT NOT NULL CHECK(state IN ('review_required','failed')),
facts_json TEXT NOT NULL CHECK(json_valid(facts_json)), warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json)), created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,document_id,source_sha256) REFERENCES ce7_documents(workspace_id,id,sha256)
);


CREATE TABLE ce7_fact_revisions (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

document_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), parent_revision_id TEXT,
facts_json TEXT NOT NULL CHECK(json_valid(facts_json)), content_hash TEXT NOT NULL CHECK(content_hash IS NULL OR (length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*')), confirmed_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,document_id,revision), UNIQUE(workspace_id,id,document_id),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,document_id) REFERENCES ce7_documents(workspace_id,id), FOREIGN KEY(workspace_id,parent_revision_id,document_id) REFERENCES ce7_fact_revisions(workspace_id,id,document_id)
);


CREATE TABLE ce7_search_intents (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

fact_revision_id TEXT NOT NULL, conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)), queries_json TEXT NOT NULL CHECK(json_valid(queries_json)), content_hash TEXT NOT NULL CHECK(content_hash IS NULL OR (length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*')), created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,fact_revision_id) REFERENCES ce7_fact_revisions(workspace_id,id)
);


CREATE TABLE ce7_tasks (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

kind TEXT NOT NULL CHECK(kind IN ('extract_resume','search_jobs','tailor_resume','render_resume','discover_similar','prepare_application','submit_application')),
state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','canceled','waiting_user')),
input_json TEXT NOT NULL CHECK(json_valid(input_json)), input_hash TEXT NOT NULL CHECK(input_hash IS NULL OR (length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*')), result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
error_code TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
provider_transmission TEXT NOT NULL DEFAULT 'not_dispatched' CHECK(provider_transmission IN ('not_dispatched','dispatched','completed','unknown')),
lease_owner TEXT, lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0), lease_until_ms INTEGER,
available_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
CHECK((state='running' AND lease_owner IS NOT NULL AND lease_generation>0 AND lease_until_ms IS NOT NULL) OR (state<>'running' AND lease_owner IS NULL AND lease_until_ms IS NULL)),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id)
);


CREATE INDEX ce7_tasks_ready ON ce7_tasks(state,available_at_ms);

CREATE TABLE ce7_search_runs (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

intent_id TEXT NOT NULL, task_id TEXT NOT NULL, provider_mode TEXT NOT NULL CHECK(provider_mode IN ('mock','live')),
state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','canceled')), outcome TEXT CHECK(outcome IS NULL OR outcome IN ('complete','partial','empty')),
created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,intent_id) REFERENCES ce7_search_intents(workspace_id,id), FOREIGN KEY(workspace_id,task_id) REFERENCES ce7_tasks(workspace_id,id)
);


CREATE TABLE ce7_job_snapshots (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

job_key TEXT NOT NULL, company_name TEXT NOT NULL, title TEXT NOT NULL, canonical_url TEXT NOT NULL, site_id TEXT NOT NULL,
content_text TEXT NOT NULL, requirements_json TEXT NOT NULL CHECK(json_valid(requirements_json)), content_hash TEXT NOT NULL CHECK(content_hash IS NULL OR (length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*')),
open_status TEXT NOT NULL CHECK(open_status IN ('open','closed','unknown')), data_origin TEXT NOT NULL CHECK(data_origin IN ('live','synthetic')), observed_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id,job_key), UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id)
);


CREATE TABLE ce7_search_results (
workspace_id TEXT NOT NULL, search_run_id TEXT NOT NULL, job_snapshot_id TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 10),
PRIMARY KEY(workspace_id,search_run_id,slot), UNIQUE(workspace_id,search_run_id,job_snapshot_id),
FOREIGN KEY(workspace_id,search_run_id) REFERENCES ce7_search_runs(workspace_id,id),
FOREIGN KEY(workspace_id,job_snapshot_id) REFERENCES ce7_job_snapshots(workspace_id,id)
);


CREATE TABLE ce7_tailoring_sessions (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

job_snapshot_id TEXT NOT NULL, fact_revision_id TEXT NOT NULL, current_resume_revision_id TEXT,
revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), state TEXT NOT NULL CHECK(state IN ('editing','ready','waiting_user','closed')), created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id,job_snapshot_id),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,job_snapshot_id) REFERENCES ce7_job_snapshots(workspace_id,id), FOREIGN KEY(workspace_id,fact_revision_id) REFERENCES ce7_fact_revisions(workspace_id,id), FOREIGN KEY(workspace_id,current_resume_revision_id,id) REFERENCES ce7_resume_revisions(workspace_id,id,session_id) DEFERRABLE INITIALLY DEFERRED
);


CREATE TABLE ce7_messages (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

session_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
base_resume_revision_id TEXT, created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,session_id) REFERENCES ce7_tailoring_sessions(workspace_id,id), FOREIGN KEY(workspace_id,base_resume_revision_id,session_id) REFERENCES ce7_resume_revisions(workspace_id,id,session_id)
);


CREATE TABLE ce7_resume_revisions (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

session_id TEXT NOT NULL, job_snapshot_id TEXT NOT NULL, fact_revision_id TEXT NOT NULL,
revision INTEGER NOT NULL CHECK(revision>=1), parent_revision_id TEXT, blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)), content_hash TEXT NOT NULL CHECK(content_hash IS NULL OR (length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*')),
state TEXT NOT NULL CHECK(state IN ('draft','final')), finalized_at_ms INTEGER, finalization_source TEXT CHECK(finalization_source IS NULL OR finalization_source IN ('user','policy')), created_at_ms INTEGER NOT NULL,
CHECK((state='draft' AND finalized_at_ms IS NULL AND finalization_source IS NULL) OR (state='final' AND finalized_at_ms IS NOT NULL AND finalization_source IS NOT NULL)),
UNIQUE(workspace_id,id,session_id), UNIQUE(workspace_id,session_id,revision),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,session_id,job_snapshot_id) REFERENCES ce7_tailoring_sessions(workspace_id,id,job_snapshot_id), FOREIGN KEY(workspace_id,fact_revision_id) REFERENCES ce7_fact_revisions(workspace_id,id), FOREIGN KEY(workspace_id,parent_revision_id,session_id) REFERENCES ce7_resume_revisions(workspace_id,id,session_id)
);


CREATE TABLE ce7_edit_proposals (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

session_id TEXT NOT NULL, base_resume_revision_id TEXT NOT NULL, base_content_hash TEXT NOT NULL CHECK(base_content_hash IS NULL OR (length(base_content_hash)=64 AND base_content_hash NOT GLOB '*[^0-9a-f]*')), changes_json TEXT NOT NULL CHECK(json_valid(changes_json)),
questions_json TEXT NOT NULL CHECK(json_valid(questions_json)), state TEXT NOT NULL CHECK(state IN ('proposed','accepted','rejected','stale')), created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,base_resume_revision_id,session_id) REFERENCES ce7_resume_revisions(workspace_id,id,session_id)
);


CREATE TABLE ce7_artifacts (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

resume_revision_id TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type='application/pdf'),
byte_size INTEGER NOT NULL CHECK(byte_size>0), sha256 TEXT NOT NULL CHECK(sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*')), object_key TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,object_key), UNIQUE(workspace_id,id,resume_revision_id,sha256),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,resume_revision_id) REFERENCES ce7_resume_revisions(workspace_id,id)
);


CREATE TABLE ce7_account_bindings (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

site_id TEXT NOT NULL, executor TEXT NOT NULL CHECK(executor IN ('chrome','ego')), account_label TEXT NOT NULL,
account_fingerprint TEXT NOT NULL CHECK(account_fingerprint IS NULL OR (length(account_fingerprint)=64 AND account_fingerprint NOT GLOB '*[^0-9a-f]*')), verified_at_ms INTEGER NOT NULL, revoked_at_ms INTEGER,
UNIQUE(workspace_id,id,executor,site_id), UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id)
);


CREATE TABLE ce7_applications (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

job_key TEXT NOT NULL, current_revision INTEGER CHECK(current_revision IS NULL OR current_revision>=1),
source_kind TEXT NOT NULL CHECK(source_kind IN ('manual','campaign')), source_campaign_id TEXT,
created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
CHECK((source_kind='manual' AND source_campaign_id IS NULL) OR (source_kind='campaign' AND source_campaign_id IS NOT NULL)),
UNIQUE(workspace_id,job_key),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,id,current_revision) REFERENCES ce7_application_revisions(workspace_id,application_id,revision) DEFERRABLE INITIALLY DEFERRED, FOREIGN KEY(workspace_id,source_campaign_id) REFERENCES ce7_campaigns(workspace_id,id)
);


CREATE TABLE ce7_application_revisions (
workspace_id TEXT NOT NULL, application_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
job_snapshot_id TEXT NOT NULL, resume_revision_id TEXT NOT NULL, artifact_id TEXT NOT NULL, artifact_sha256 TEXT NOT NULL CHECK(artifact_sha256 IS NULL OR (length(artifact_sha256)=64 AND artifact_sha256 NOT GLOB '*[^0-9a-f]*')),
answers_json TEXT NOT NULL CHECK(json_valid(answers_json)), payload_hash TEXT NOT NULL CHECK(payload_hash IS NULL OR (length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*')), created_at_ms INTEGER NOT NULL,
PRIMARY KEY(workspace_id,application_id,revision),
UNIQUE(workspace_id,application_id,revision,payload_hash),
UNIQUE(workspace_id,application_id,revision,job_snapshot_id,resume_revision_id),
FOREIGN KEY(workspace_id,application_id) REFERENCES ce7_applications(workspace_id,id),
FOREIGN KEY(workspace_id,job_snapshot_id) REFERENCES ce7_job_snapshots(workspace_id,id),
FOREIGN KEY(workspace_id,artifact_id,resume_revision_id,artifact_sha256) REFERENCES ce7_artifacts(workspace_id,id,resume_revision_id,sha256)
);


CREATE TABLE ce7_policy_controls (
workspace_id TEXT NOT NULL, policy_id TEXT NOT NULL, active_revision_id TEXT,
state TEXT NOT NULL CHECK(state IN ('draft','active','paused','revoked','expired')), generation INTEGER NOT NULL CHECK(generation>=1), updated_at_ms INTEGER NOT NULL,
PRIMARY KEY(workspace_id,policy_id),
CHECK(state<>'active' OR active_revision_id IS NOT NULL),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id), FOREIGN KEY(workspace_id,active_revision_id,policy_id) REFERENCES ce7_policy_revisions(workspace_id,id,policy_id) DEFERRABLE INITIALLY DEFERRED
);


CREATE TABLE ce7_policy_revisions (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

policy_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), parent_revision_id TEXT,
mode TEXT NOT NULL CHECK(mode IN ('recommend','prepare','submit')), document_strategy TEXT NOT NULL CHECK(document_strategy IN ('fixed_document','tailor_within_facts')),
fact_revision_id TEXT NOT NULL, seed_resume_revision_id TEXT NOT NULL, fixed_artifact_id TEXT,
conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)), allowed_sites_json TEXT NOT NULL CHECK(json_valid(allowed_sites_json)), account_bindings_json TEXT NOT NULL CHECK(json_valid(account_bindings_json)),
excluded_companies_json TEXT NOT NULL CHECK(json_valid(excluded_companies_json)), allowed_edits_json TEXT NOT NULL CHECK(json_valid(allowed_edits_json)),
daily_limit INTEGER NOT NULL CHECK(daily_limit>=1), total_limit INTEGER NOT NULL CHECK(total_limit>=1),
budget_limit_micro_usd INTEGER NOT NULL CHECK(budget_limit_micro_usd>=0), quota_timezone TEXT NOT NULL CHECK(quota_timezone='Asia/Seoul'),
valid_from_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>valid_from_ms), content_hash TEXT NOT NULL CHECK(content_hash IS NULL OR (length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*')), created_at_ms INTEGER NOT NULL,
CHECK((document_strategy='fixed_document' AND fixed_artifact_id IS NOT NULL AND json_array_length(allowed_edits_json)=0) OR (document_strategy='tailor_within_facts' AND fixed_artifact_id IS NULL)),
UNIQUE(workspace_id,id,policy_id), UNIQUE(workspace_id,policy_id,revision),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,policy_id) REFERENCES ce7_policy_controls(workspace_id,policy_id), FOREIGN KEY(workspace_id,parent_revision_id,policy_id) REFERENCES ce7_policy_revisions(workspace_id,id,policy_id), FOREIGN KEY(workspace_id,fact_revision_id) REFERENCES ce7_fact_revisions(workspace_id,id), FOREIGN KEY(workspace_id,seed_resume_revision_id) REFERENCES ce7_resume_revisions(workspace_id,id), FOREIGN KEY(workspace_id,fixed_artifact_id) REFERENCES ce7_artifacts(workspace_id,id)
);


CREATE TABLE ce7_campaigns (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

policy_revision_id TEXT NOT NULL, seed_application_id TEXT NOT NULL, seed_application_revision INTEGER NOT NULL,
seed_job_snapshot_id TEXT NOT NULL, seed_resume_revision_id TEXT NOT NULL,
state TEXT NOT NULL CHECK(state IN ('draft','active','paused','completed','canceled')), created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id,policy_revision_id),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,policy_revision_id) REFERENCES ce7_policy_revisions(workspace_id,id), FOREIGN KEY(workspace_id,seed_application_id,seed_application_revision,seed_job_snapshot_id,seed_resume_revision_id) REFERENCES ce7_application_revisions(workspace_id,application_id,revision,job_snapshot_id,resume_revision_id)
);


CREATE TABLE ce7_campaign_jobs (
workspace_id TEXT NOT NULL, campaign_id TEXT NOT NULL, job_snapshot_id TEXT NOT NULL, application_id TEXT,
state TEXT NOT NULL CHECK(state IN ('discovered','needs_review','eligible','prepared','queued','skipped')), similarity_json TEXT NOT NULL CHECK(json_valid(similarity_json)),
PRIMARY KEY(workspace_id,campaign_id,job_snapshot_id),
FOREIGN KEY(workspace_id,campaign_id) REFERENCES ce7_campaigns(workspace_id,id),
FOREIGN KEY(workspace_id,job_snapshot_id) REFERENCES ce7_job_snapshots(workspace_id,id),
FOREIGN KEY(workspace_id,application_id) REFERENCES ce7_applications(workspace_id,id)
);


CREATE TABLE ce7_authorizations (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

application_id TEXT NOT NULL, application_revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('manual','policy')),
job_snapshot_id TEXT NOT NULL, resume_revision_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
artifact_sha256 TEXT NOT NULL CHECK(artifact_sha256 IS NULL OR (length(artifact_sha256)=64 AND artifact_sha256 NOT GLOB '*[^0-9a-f]*')), payload_hash TEXT NOT NULL CHECK(payload_hash IS NULL OR (length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*')), executor TEXT NOT NULL CHECK(executor IN ('chrome','ego')),
site_id TEXT NOT NULL, adapter_version TEXT NOT NULL, account_binding_id TEXT NOT NULL, target_url TEXT NOT NULL, form_snapshot_hash TEXT NOT NULL CHECK(form_snapshot_hash IS NULL OR (length(form_snapshot_hash)=64 AND form_snapshot_hash NOT GLOB '*[^0-9a-f]*')),
user_reviewed_at_ms INTEGER, policy_revision_id TEXT, policy_generation INTEGER, campaign_id TEXT, policy_evaluation_hash TEXT   CHECK(policy_evaluation_hash IS NULL OR (length(policy_evaluation_hash)=64 AND policy_evaluation_hash NOT GLOB '*[^0-9a-f]*')),
created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms), revoked_at_ms INTEGER,
CHECK((kind='manual' AND user_reviewed_at_ms IS NOT NULL AND policy_revision_id IS NULL AND policy_generation IS NULL AND campaign_id IS NULL AND policy_evaluation_hash IS NULL) OR
(kind='policy' AND user_reviewed_at_ms IS NULL AND policy_revision_id IS NOT NULL AND policy_generation>=1 AND campaign_id IS NOT NULL AND policy_evaluation_hash IS NOT NULL)),
UNIQUE(workspace_id,id,application_id,executor),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,application_id,application_revision,payload_hash) REFERENCES ce7_application_revisions(workspace_id,application_id,revision,payload_hash), FOREIGN KEY(workspace_id,application_id,application_revision,job_snapshot_id,resume_revision_id) REFERENCES ce7_application_revisions(workspace_id,application_id,revision,job_snapshot_id,resume_revision_id), FOREIGN KEY(workspace_id,artifact_id,resume_revision_id,artifact_sha256) REFERENCES ce7_artifacts(workspace_id,id,resume_revision_id,sha256), FOREIGN KEY(workspace_id,account_binding_id,executor,site_id) REFERENCES ce7_account_bindings(workspace_id,id,executor,site_id), FOREIGN KEY(workspace_id,campaign_id,policy_revision_id) REFERENCES ce7_campaigns(workspace_id,id,policy_revision_id)
);


CREATE TABLE ce7_attempts (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

application_id TEXT NOT NULL, authorization_id TEXT NOT NULL, executor TEXT NOT NULL CHECK(executor IN ('chrome','ego')),
state TEXT NOT NULL CHECK(state IN ('prepared','dispatched','submitted','submission_unknown','not_submitted','failed_before_dispatch')),
dispatch_started_at_ms INTEGER, error_code TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
CHECK(state NOT IN ('dispatched','submitted','submission_unknown') OR dispatch_started_at_ms IS NOT NULL),
CHECK(state NOT IN ('prepared','failed_before_dispatch') OR dispatch_started_at_ms IS NULL),
UNIQUE(workspace_id,authorization_id),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,authorization_id,application_id,executor) REFERENCES ce7_authorizations(workspace_id,id,application_id,executor)
);


CREATE UNIQUE INDEX ce7_one_effect_per_application ON ce7_attempts(workspace_id,application_id) WHERE state IN ('prepared','dispatched','submitted','submission_unknown');

CREATE TABLE ce7_submission_evidence (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

attempt_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('confirmation_page','receipt_id','user_report','no_delivery_proof')),
conclusion TEXT NOT NULL CHECK(conclusion IN ('submitted','not_submitted','unknown')), summary TEXT NOT NULL, evidence_hash TEXT NOT NULL CHECK(evidence_hash IS NULL OR (length(evidence_hash)=64 AND evidence_hash NOT GLOB '*[^0-9a-f]*')), observed_at_ms INTEGER NOT NULL, source_url TEXT,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,attempt_id) REFERENCES ce7_attempts(workspace_id,id)
);


CREATE TABLE ce7_quota_reservations (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

policy_id TEXT NOT NULL, policy_revision_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
business_date TEXT NOT NULL CHECK(business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released')), cost_reserved_micro_usd INTEGER NOT NULL CHECK(cost_reserved_micro_usd>=0), created_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,attempt_id),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,policy_revision_id,policy_id) REFERENCES ce7_policy_revisions(workspace_id,id,policy_id), FOREIGN KEY(workspace_id,attempt_id) REFERENCES ce7_attempts(workspace_id,id)
);


CREATE TABLE ce7_recruitment_events (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

application_id TEXT NOT NULL, stage TEXT NOT NULL CHECK(stage IN ('unknown','review','interview','offer','rejected','withdrawn')),
source TEXT NOT NULL CHECK(source IN ('user','verified_integration')), note TEXT NOT NULL, observed_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,application_id) REFERENCES ce7_applications(workspace_id,id)
);


CREATE TABLE ce7_request_keys (
workspace_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL CHECK(request_hash IS NULL OR (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*')), response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at_ms INTEGER NOT NULL,
PRIMARY KEY(workspace_id,operation,idempotency_key), FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id)
);


CREATE TABLE ce7_provider_calls (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

task_id TEXT NOT NULL, provider TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('search','extract','chat','render')),
request_hash TEXT NOT NULL CHECK(request_hash IS NULL OR (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*')), status TEXT NOT NULL CHECK(status IN ('reserved','dispatched','succeeded','failed','unknown')),
reserved_micro_usd INTEGER NOT NULL CHECK(reserved_micro_usd>=0), verified_micro_usd INTEGER CHECK(verified_micro_usd IS NULL OR verified_micro_usd>=0),
lease_generation INTEGER NOT NULL CHECK(lease_generation>=1), created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,task_id) REFERENCES ce7_tasks(workspace_id,id)
);


CREATE TRIGGER ce7_extractions_immutable BEFORE UPDATE ON ce7_extractions BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_fact_revisions_immutable BEFORE UPDATE ON ce7_fact_revisions BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_search_intents_immutable BEFORE UPDATE ON ce7_search_intents BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_job_snapshots_immutable BEFORE UPDATE ON ce7_job_snapshots BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_messages_immutable BEFORE UPDATE ON ce7_messages BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_artifacts_immutable BEFORE UPDATE ON ce7_artifacts BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_application_revisions_immutable BEFORE UPDATE ON ce7_application_revisions BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_policy_revisions_immutable BEFORE UPDATE ON ce7_policy_revisions BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_submission_evidence_immutable BEFORE UPDATE ON ce7_submission_evidence BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_recruitment_events_immutable BEFORE UPDATE ON ce7_recruitment_events BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;


CREATE TRIGGER ce7_documents_identity BEFORE UPDATE ON ce7_documents WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.input_kind IS NOT OLD.input_kind OR NEW.filename IS NOT OLD.filename OR NEW.mime_type IS NOT OLD.mime_type OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.object_key IS NOT OLD.object_key OR NEW.data_origin IS NOT OLD.data_origin OR NEW.created_at_ms IS NOT OLD.created_at_ms BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_PAYLOAD');
END;


CREATE TRIGGER ce7_resume_revisions_identity BEFORE UPDATE ON ce7_resume_revisions WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.session_id IS NOT OLD.session_id OR NEW.job_snapshot_id IS NOT OLD.job_snapshot_id OR NEW.fact_revision_id IS NOT OLD.fact_revision_id OR NEW.revision IS NOT OLD.revision OR NEW.parent_revision_id IS NOT OLD.parent_revision_id OR NEW.blocks_json IS NOT OLD.blocks_json OR NEW.content_hash IS NOT OLD.content_hash OR NEW.created_at_ms IS NOT OLD.created_at_ms BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_PAYLOAD');
END;


CREATE TRIGGER ce7_edit_proposals_identity BEFORE UPDATE ON ce7_edit_proposals WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.session_id IS NOT OLD.session_id OR NEW.base_resume_revision_id IS NOT OLD.base_resume_revision_id OR NEW.base_content_hash IS NOT OLD.base_content_hash OR NEW.changes_json IS NOT OLD.changes_json OR NEW.questions_json IS NOT OLD.questions_json OR NEW.created_at_ms IS NOT OLD.created_at_ms BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_PAYLOAD');
END;


CREATE TRIGGER ce7_campaigns_identity BEFORE UPDATE ON ce7_campaigns WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.policy_revision_id IS NOT OLD.policy_revision_id OR NEW.seed_application_id IS NOT OLD.seed_application_id OR NEW.seed_application_revision IS NOT OLD.seed_application_revision OR NEW.seed_job_snapshot_id IS NOT OLD.seed_job_snapshot_id OR NEW.seed_resume_revision_id IS NOT OLD.seed_resume_revision_id OR NEW.created_at_ms IS NOT OLD.created_at_ms BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_PAYLOAD');
END;


CREATE TRIGGER ce7_authorizations_identity BEFORE UPDATE ON ce7_authorizations WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.application_id IS NOT OLD.application_id OR NEW.application_revision IS NOT OLD.application_revision OR NEW.kind IS NOT OLD.kind OR NEW.job_snapshot_id IS NOT OLD.job_snapshot_id OR NEW.resume_revision_id IS NOT OLD.resume_revision_id OR NEW.artifact_id IS NOT OLD.artifact_id OR NEW.artifact_sha256 IS NOT OLD.artifact_sha256 OR NEW.payload_hash IS NOT OLD.payload_hash OR NEW.executor IS NOT OLD.executor OR NEW.site_id IS NOT OLD.site_id OR NEW.adapter_version IS NOT OLD.adapter_version OR NEW.account_binding_id IS NOT OLD.account_binding_id OR NEW.target_url IS NOT OLD.target_url OR NEW.form_snapshot_hash IS NOT OLD.form_snapshot_hash OR NEW.user_reviewed_at_ms IS NOT OLD.user_reviewed_at_ms OR NEW.policy_revision_id IS NOT OLD.policy_revision_id OR NEW.policy_generation IS NOT OLD.policy_generation OR NEW.campaign_id IS NOT OLD.campaign_id OR NEW.policy_evaluation_hash IS NOT OLD.policy_evaluation_hash OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.expires_at_ms IS NOT OLD.expires_at_ms BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_PAYLOAD');
END;


CREATE TRIGGER ce7_attempts_identity BEFORE UPDATE ON ce7_attempts WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.application_id IS NOT OLD.application_id OR NEW.authorization_id IS NOT OLD.authorization_id OR NEW.executor IS NOT OLD.executor OR NEW.created_at_ms IS NOT OLD.created_at_ms BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_PAYLOAD');
END;


CREATE TRIGGER ce7_quota_reservations_identity BEFORE UPDATE ON ce7_quota_reservations WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.policy_revision_id IS NOT OLD.policy_revision_id OR NEW.attempt_id IS NOT OLD.attempt_id OR NEW.business_date IS NOT OLD.business_date OR NEW.cost_reserved_micro_usd IS NOT OLD.cost_reserved_micro_usd OR NEW.created_at_ms IS NOT OLD.created_at_ms BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_PAYLOAD');
END;


CREATE TRIGGER ce7_final_resume_frozen BEFORE UPDATE ON ce7_resume_revisions WHEN OLD.state='final' BEGIN
SELECT RAISE(ABORT,'FINAL_RESUME_IMMUTABLE');
END;


CREATE TRIGGER ce7_artifact_requires_final BEFORE INSERT ON ce7_artifacts WHEN NOT EXISTS(SELECT 1 FROM ce7_resume_revisions r WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.resume_revision_id AND r.state='final') BEGIN
SELECT RAISE(ABORT,'RESUME_NOT_FINAL');
END;


CREATE TRIGGER ce7_application_job_binding BEFORE INSERT ON ce7_application_revisions WHEN NOT EXISTS(SELECT 1 FROM ce7_applications a JOIN ce7_job_snapshots j ON j.workspace_id=a.workspace_id AND j.job_key=a.job_key WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.application_id AND j.id=NEW.job_snapshot_id) BEGIN
SELECT RAISE(ABORT,'APPLICATION_JOB_MISMATCH');
END;


CREATE TRIGGER ce7_application_head_active BEFORE UPDATE OF current_revision ON ce7_applications WHEN EXISTS(SELECT 1 FROM ce7_attempts t WHERE t.workspace_id=OLD.workspace_id AND t.application_id=OLD.id AND t.state IN ('prepared','dispatched','submitted','submission_unknown')) AND NEW.current_revision IS NOT OLD.current_revision BEGIN
SELECT RAISE(ABORT,'ACTIVE_OR_SUBMITTED_APPLICATION');
END;


CREATE TRIGGER ce7_authorization_not_unrevoked BEFORE UPDATE ON ce7_authorizations WHEN OLD.revoked_at_ms IS NOT NULL AND NEW.revoked_at_ms IS NOT OLD.revoked_at_ms BEGIN
SELECT RAISE(ABORT,'REVOCATION_IS_FINAL');
END;


CREATE TRIGGER ce7_authorization_binding BEFORE INSERT ON ce7_authorizations BEGIN

SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ce7_applications a JOIN ce7_application_revisions r ON r.workspace_id=a.workspace_id AND r.application_id=a.id AND r.revision=a.current_revision WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.application_id AND r.revision=NEW.application_revision AND r.artifact_id=NEW.artifact_id AND r.artifact_sha256=NEW.artifact_sha256) THEN RAISE(ABORT,'STALE_OR_MISMATCHED_AUTHORIZATION') END;

END;


CREATE TRIGGER ce7_attempt_prepare BEFORE INSERT ON ce7_attempts BEGIN

SELECT CASE WHEN NEW.state<>'prepared' THEN RAISE(ABORT,'ATTEMPT_MUST_START_PREPARED') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ce7_authorizations g JOIN ce7_applications a ON a.workspace_id=g.workspace_id AND a.id=g.application_id JOIN ce7_account_bindings b ON b.workspace_id=g.workspace_id AND b.id=g.account_binding_id WHERE g.workspace_id=NEW.workspace_id AND g.id=NEW.authorization_id AND g.application_revision=a.current_revision AND g.revoked_at_ms IS NULL AND b.revoked_at_ms IS NULL AND NEW.created_at_ms>=g.created_at_ms AND NEW.created_at_ms<g.expires_at_ms) THEN RAISE(ABORT,'AUTHORIZATION_UNAVAILABLE') END;
SELECT CASE WHEN EXISTS(SELECT 1 FROM ce7_authorizations g WHERE g.workspace_id=NEW.workspace_id AND g.id=NEW.authorization_id AND g.kind='policy') AND NOT EXISTS(SELECT 1 FROM ce7_authorizations g JOIN ce7_policy_revisions p ON p.workspace_id=g.workspace_id AND p.id=g.policy_revision_id JOIN ce7_policy_controls c ON c.workspace_id=p.workspace_id AND c.policy_id=p.policy_id JOIN ce7_campaigns k ON k.workspace_id=g.workspace_id AND k.id=g.campaign_id WHERE g.workspace_id=NEW.workspace_id AND g.id=NEW.authorization_id AND p.mode='submit' AND c.state='active' AND c.active_revision_id=p.id AND c.generation=g.policy_generation AND k.state='active' AND NEW.created_at_ms>=p.valid_from_ms AND NEW.created_at_ms<p.expires_at_ms) THEN RAISE(ABORT,'POLICY_NOT_ACTIVE') END;

END;


CREATE TRIGGER ce7_attempt_transition BEFORE UPDATE OF state ON ce7_attempts BEGIN

SELECT CASE WHEN NOT ((OLD.state='prepared' AND NEW.state IN ('dispatched','failed_before_dispatch','not_submitted')) OR (OLD.state='dispatched' AND NEW.state IN ('submitted','submission_unknown','not_submitted')) OR (OLD.state='submission_unknown' AND NEW.state IN ('submitted','not_submitted')) OR OLD.state=NEW.state) THEN RAISE(ABORT,'INVALID_ATTEMPT_TRANSITION') END;
SELECT CASE WHEN NEW.state='submitted' AND NOT EXISTS(SELECT 1 FROM ce7_submission_evidence e WHERE e.workspace_id=NEW.workspace_id AND e.attempt_id=NEW.id AND e.conclusion='submitted' AND e.kind IN ('confirmation_page','receipt_id','user_report')) THEN RAISE(ABORT,'SUBMISSION_EVIDENCE_REQUIRED') END;
SELECT CASE WHEN NEW.state='not_submitted' AND OLD.dispatch_started_at_ms IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ce7_submission_evidence e WHERE e.workspace_id=NEW.workspace_id AND e.attempt_id=NEW.id AND e.conclusion='not_submitted' AND e.kind='no_delivery_proof') THEN RAISE(ABORT,'NO_DELIVERY_PROOF_REQUIRED') END;

END;


CREATE TRIGGER ce7_attempt_dispatch BEFORE UPDATE OF state ON ce7_attempts WHEN OLD.state='prepared' AND NEW.state='dispatched' BEGIN

SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ce7_authorizations g JOIN ce7_account_bindings b ON b.workspace_id=g.workspace_id AND b.id=g.account_binding_id WHERE g.workspace_id=NEW.workspace_id AND g.id=NEW.authorization_id AND g.revoked_at_ms IS NULL AND b.revoked_at_ms IS NULL AND NEW.dispatch_started_at_ms>=g.created_at_ms AND NEW.dispatch_started_at_ms<g.expires_at_ms) THEN RAISE(ABORT,'DISPATCH_AUTHORIZATION_EXPIRED') END;
SELECT CASE WHEN EXISTS(SELECT 1 FROM ce7_authorizations g WHERE g.workspace_id=NEW.workspace_id AND g.id=NEW.authorization_id AND g.kind='policy') AND NOT EXISTS(SELECT 1 FROM ce7_authorizations g JOIN ce7_policy_revisions p ON p.workspace_id=g.workspace_id AND p.id=g.policy_revision_id JOIN ce7_policy_controls c ON c.workspace_id=p.workspace_id AND c.policy_id=p.policy_id JOIN ce7_campaigns k ON k.workspace_id=g.workspace_id AND k.id=g.campaign_id JOIN ce7_quota_reservations q ON q.workspace_id=NEW.workspace_id AND q.attempt_id=NEW.id AND q.policy_revision_id=p.id WHERE g.workspace_id=NEW.workspace_id AND g.id=NEW.authorization_id AND p.mode='submit' AND c.state='active' AND c.active_revision_id=p.id AND c.generation=g.policy_generation AND k.state='active' AND q.state='reserved' AND NEW.dispatch_started_at_ms>=p.valid_from_ms AND NEW.dispatch_started_at_ms<p.expires_at_ms) THEN RAISE(ABORT,'POLICY_OR_QUOTA_NOT_READY') END;

END;


CREATE TRIGGER ce7_quota_insert BEFORE INSERT ON ce7_quota_reservations BEGIN

SELECT CASE WHEN NEW.state<>'reserved' THEN RAISE(ABORT,'QUOTA_MUST_START_RESERVED') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ce7_attempts t JOIN ce7_authorizations g ON g.workspace_id=t.workspace_id AND g.id=t.authorization_id WHERE t.workspace_id=NEW.workspace_id AND t.id=NEW.attempt_id AND t.state='prepared' AND g.kind='policy' AND g.policy_revision_id=NEW.policy_revision_id) THEN RAISE(ABORT,'QUOTA_ATTEMPT_MISMATCH') END;
SELECT CASE WHEN (SELECT count(*) FROM ce7_quota_reservations q WHERE q.workspace_id=NEW.workspace_id AND q.policy_id=NEW.policy_id AND q.state IN ('reserved','consumed')) >= (SELECT total_limit FROM ce7_policy_revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.policy_revision_id) THEN RAISE(ABORT,'TOTAL_LIMIT') END;
SELECT CASE WHEN (SELECT count(*) FROM ce7_quota_reservations q WHERE q.workspace_id=NEW.workspace_id AND q.policy_id=NEW.policy_id AND q.business_date=NEW.business_date AND q.state IN ('reserved','consumed')) >= (SELECT daily_limit FROM ce7_policy_revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.policy_revision_id) THEN RAISE(ABORT,'DAILY_LIMIT') END;
SELECT CASE WHEN NEW.cost_reserved_micro_usd + COALESCE((SELECT sum(cost_reserved_micro_usd) FROM ce7_quota_reservations q WHERE q.workspace_id=NEW.workspace_id AND q.policy_id=NEW.policy_id AND q.state IN ('reserved','consumed')),0) > (SELECT budget_limit_micro_usd FROM ce7_policy_revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.policy_revision_id) THEN RAISE(ABORT,'POLICY_BUDGET_LIMIT') END;

END;


CREATE TRIGGER ce7_quota_transition BEFORE UPDATE OF state ON ce7_quota_reservations BEGIN

SELECT CASE WHEN OLD.state<>'reserved' AND NEW.state<>OLD.state THEN RAISE(ABORT,'QUOTA_TERMINAL') END;
SELECT CASE WHEN NEW.state='released' AND NOT EXISTS(SELECT 1 FROM ce7_attempts t WHERE t.workspace_id=NEW.workspace_id AND t.id=NEW.attempt_id AND t.dispatch_started_at_ms IS NULL AND t.state IN ('failed_before_dispatch','not_submitted')) THEN RAISE(ABORT,'QUOTA_RELEASE_NOT_PROVEN') END;
SELECT CASE WHEN NEW.state='consumed' AND NOT EXISTS(SELECT 1 FROM ce7_attempts t WHERE t.workspace_id=NEW.workspace_id AND t.id=NEW.attempt_id AND t.dispatch_started_at_ms IS NOT NULL) THEN RAISE(ABORT,'QUOTA_NOT_DISPATCHED') END;

END;


CREATE TRIGGER ce7_dispatch_time_immutable BEFORE UPDATE ON ce7_attempts
WHEN OLD.dispatch_started_at_ms IS NOT NULL AND NEW.dispatch_started_at_ms IS NOT OLD.dispatch_started_at_ms
BEGIN SELECT RAISE(ABORT,'DISPATCH_TIME_IMMUTABLE'); END;
CREATE TRIGGER ce7_terminal_attempt_immutable BEFORE UPDATE ON ce7_attempts
WHEN OLD.state IN ('submitted','not_submitted','failed_before_dispatch')
BEGIN SELECT RAISE(ABORT,'TERMINAL_ATTEMPT_IMMUTABLE'); END;
CREATE TRIGGER ce7_policy_control_generation BEFORE UPDATE ON ce7_policy_controls
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.generation<>OLD.generation+1
BEGIN SELECT RAISE(ABORT,'POLICY_GENERATION_MUST_ADVANCE'); END;
CREATE TRIGGER ce7_policy_seed_binding BEFORE INSERT ON ce7_policy_revisions
BEGIN
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ce7_resume_revisions r WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.seed_resume_revision_id AND r.fact_revision_id=NEW.fact_revision_id AND r.state='final') THEN RAISE(ABORT,'POLICY_SEED_FACT_MISMATCH') END;
SELECT CASE WHEN NEW.document_strategy='fixed_document' AND NOT EXISTS(SELECT 1 FROM ce7_artifacts a WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.fixed_artifact_id AND a.resume_revision_id=NEW.seed_resume_revision_id) THEN RAISE(ABORT,'POLICY_FIXED_ARTIFACT_MISMATCH') END;
END;
CREATE TRIGGER ce7_real_document_owner BEFORE INSERT ON ce7_documents
WHEN NEW.data_origin='user' AND NOT EXISTS(SELECT 1 FROM ce7_workspace_owners o JOIN ce7_principals p ON p.id=o.principal_id WHERE o.workspace_id=NEW.workspace_id AND p.mode='authenticated')
BEGIN SELECT RAISE(ABORT,'AUTHENTICATED_OWNER_REQUIRED'); END;

CREATE TRIGGER ce7_application_identity BEFORE UPDATE ON ce7_applications
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.job_key IS NOT OLD.job_key OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_campaign_id IS NOT OLD.source_campaign_id OR NEW.created_at_ms IS NOT OLD.created_at_ms
BEGIN SELECT RAISE(ABORT,'APPLICATION_IDENTITY_IMMUTABLE'); END;
