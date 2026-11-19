-- Career Evidence v0.4 -- SQLite migration candidate, not a deployed service.
-- Run on an empty database. No migrations, network calls, or application API
-- implementation are performed by this file.
-- Every server/worker connection MUST enable and verify foreign_keys=ON before
-- beginning a transaction. The pragma here covers only the connection loading
-- this file. All *_at_ms / *_until_ms fields are UTC Unix epoch milliseconds.
-- JSON shape, canonical serialization, SHA-256 correctness, clock checks,
-- authorization, exact origin allowlisting and CAS request preconditions remain
-- server responsibilities. A stored hash is an identity check, not authority.
-- The analysis selection limit (three distinct candidates per request) is an
-- API/runtime rule; SQLite intentionally does not inspect tasks.input_json for it.
-- request_keys.request_hash covers the HTTP method, normalized actual path
-- (including resource IDs), and JCS(body). Canonical framing/hash computation,
-- same-key replay/different-target rejection, and polymorphic result ownership
-- are runtime responsibilities; request_keys only protects key uniqueness.
-- Session creation sets expires_at_ms = created_at_ms + 604800000 (seven days).
-- Actual expiry enforcement, provider cost reservation/reconciliation, and
-- generation/owner CAS for worker writes remain runtime responsibilities.

PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE workspaces (
    id TEXT NOT NULL PRIMARY KEY,
    session_token_hash TEXT NOT NULL UNIQUE CHECK(length(session_token_hash) = 64),
    csrf_token_hash TEXT NOT NULL CHECK(length(csrf_token_hash) = 64),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    current_context_id TEXT,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > created_at_ms),
    -- Zero means live provider dispatch is disabled by the service layer.
    budget_limit_micro_usd INTEGER NOT NULL DEFAULT 0
      CHECK(typeof(budget_limit_micro_usd) = 'integer' AND budget_limit_micro_usd >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
    CHECK((revision = 0 AND current_context_id IS NULL) OR
          (revision > 0 AND current_context_id IS NOT NULL)),
    FOREIGN KEY(id, current_context_id)
      REFERENCES context_revisions(workspace_id, id)
      DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE context_revisions (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision >= 1),
    profile_id TEXT NOT NULL,
    profile_revision INTEGER NOT NULL CHECK(profile_revision >= 1),
    profile_json TEXT NOT NULL CHECK(json_valid(profile_json)),
    conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)),
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, revision),
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE tasks (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    context_revision_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('search', 'analysis', 'brief')),
    state TEXT NOT NULL DEFAULT 'queued'
      CHECK(state IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
    outcome TEXT CHECK(outcome IS NULL OR outcome IN ('complete', 'partial', 'empty')),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0, 1)),
    retry_of_task_id TEXT,
    input_json TEXT NOT NULL CHECK(json_valid(input_json)),
    input_hash TEXT NOT NULL CHECK(length(input_hash) = 64),
    progress_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(progress_json)),
    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
    error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
    max_retries INTEGER NOT NULL DEFAULT 2 CHECK(max_retries >= 0),
    available_at_ms INTEGER NOT NULL CHECK(available_at_ms >= 0),
    lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
    lease_owner TEXT,
    lease_until_ms INTEGER,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, context_revision_id),
    CHECK((state = 'running' AND lease_generation > 0 AND lease_owner IS NOT NULL
           AND lease_until_ms IS NOT NULL) OR
          (state <> 'running' AND lease_owner IS NULL AND lease_until_ms IS NULL)),
    CHECK(state NOT IN ('queued', 'running') OR outcome IS NULL),
    CHECK(state <> 'succeeded' OR (outcome IS NOT NULL AND error_json IS NULL)),
    FOREIGN KEY(workspace_id, context_revision_id)
      REFERENCES context_revisions(workspace_id, id),
    FOREIGN KEY(workspace_id, retry_of_task_id) REFERENCES tasks(workspace_id, id)
);
CREATE INDEX tasks_ready ON tasks(state, available_at_ms);

CREATE TABLE provider_calls (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    call_number INTEGER NOT NULL CHECK(call_number >= 1),
    lease_generation INTEGER NOT NULL CHECK(lease_generation >= 1),
    provider TEXT NOT NULL DEFAULT 'liner' CHECK(provider = 'liner'),
    endpoint TEXT NOT NULL,
    request_json TEXT NOT NULL CHECK(json_valid(request_json)),
    request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
    status TEXT NOT NULL DEFAULT 'reserved'
      CHECK(status IN ('reserved', 'dispatched', 'succeeded', 'failed', 'unknown')),
    estimated_cost_micro_usd INTEGER NOT NULL DEFAULT 0
      CHECK(typeof(estimated_cost_micro_usd) = 'integer' AND estimated_cost_micro_usd >= 0),
    billing_status TEXT NOT NULL DEFAULT 'not_dispatched'
      CHECK(billing_status IN ('not_dispatched', 'estimated', 'unknown', 'verified')),
    verified_cost_micro_usd INTEGER
      CHECK(verified_cost_micro_usd IS NULL OR
            (typeof(verified_cost_micro_usd) = 'integer' AND verified_cost_micro_usd >= 0)),
    provider_request_id TEXT,
    partial_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(partial_json)),
    received_event_count INTEGER NOT NULL DEFAULT 0 CHECK(received_event_count >= 0),
    last_event_id TEXT,
    response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
    error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, task_id),
    UNIQUE(workspace_id, task_id, call_number),
    CHECK((billing_status = 'verified' AND verified_cost_micro_usd IS NOT NULL) OR
          (billing_status <> 'verified' AND verified_cost_micro_usd IS NULL)),
    FOREIGN KEY(workspace_id, task_id) REFERENCES tasks(workspace_id, id)
);

CREATE TABLE search_runs (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    context_revision_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    query_json TEXT NOT NULL CHECK(json_valid(query_json)),
    query_hash TEXT NOT NULL CHECK(length(query_hash) = 64),
    selected_company_key TEXT,
    research_task_id TEXT,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    sealed_at_ms INTEGER,
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, task_id),
    CHECK((selected_company_key IS NULL AND research_task_id IS NULL) OR
          (selected_company_key IS NOT NULL AND research_task_id IS NOT NULL)),
    CHECK(sealed_at_ms IS NULL OR sealed_at_ms >= created_at_ms),
    FOREIGN KEY(workspace_id, task_id, context_revision_id)
      REFERENCES tasks(workspace_id, id, context_revision_id),
    FOREIGN KEY(workspace_id, research_task_id) REFERENCES tasks(workspace_id, id)
);

CREATE TABLE job_candidates (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    search_run_id TEXT NOT NULL,
    candidate_slot INTEGER NOT NULL CHECK(candidate_slot BETWEEN 1 AND 10),
    job_key TEXT NOT NULL,
    company_key TEXT NOT NULL,
    company_name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    collected_at_ms INTEGER NOT NULL CHECK(collected_at_ms >= 0),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, job_key),
    UNIQUE(workspace_id, search_run_id, candidate_slot),
    UNIQUE(workspace_id, search_run_id, job_key),
    FOREIGN KEY(workspace_id, search_run_id) REFERENCES search_runs(workspace_id, id)
);

CREATE TABLE fact_bundles (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    provider_call_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('job', 'company')),
    data_origin TEXT NOT NULL CHECK(data_origin IN ('live', 'fixture')),
    sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
    claims_json TEXT NOT NULL CHECK(json_valid(claims_json)),
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, candidate_id),
    FOREIGN KEY(workspace_id, candidate_id) REFERENCES job_candidates(workspace_id, id),
    FOREIGN KEY(workspace_id, task_id) REFERENCES tasks(workspace_id, id),
    FOREIGN KEY(workspace_id, provider_call_id, task_id)
      REFERENCES provider_calls(workspace_id, id, task_id),
    CHECK(data_origin <> 'live' OR provider_call_id IS NOT NULL)
);

CREATE TABLE assessments (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    context_revision_id TEXT NOT NULL,
    fact_bundle_id TEXT NOT NULL,
    ruleset_version TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('review', 'needs_information', 'hold')),
    result_json TEXT NOT NULL CHECK(json_valid(result_json)),
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, candidate_id, context_revision_id),
    UNIQUE(workspace_id, candidate_id, context_revision_id, fact_bundle_id, ruleset_version),
    FOREIGN KEY(workspace_id, context_revision_id)
      REFERENCES context_revisions(workspace_id, id),
    FOREIGN KEY(workspace_id, fact_bundle_id, candidate_id)
      REFERENCES fact_bundles(workspace_id, id, candidate_id)
);

CREATE TABLE brief_snapshots (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    context_revision_id TEXT NOT NULL,
    assessment_id TEXT NOT NULL,
    company_fact_bundle_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    body_json TEXT NOT NULL CHECK(json_valid(body_json)),
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, candidate_id, context_revision_id),
    FOREIGN KEY(workspace_id, assessment_id, candidate_id, context_revision_id)
      REFERENCES assessments(workspace_id, id, candidate_id, context_revision_id),
    FOREIGN KEY(workspace_id, company_fact_bundle_id, candidate_id)
      REFERENCES fact_bundles(workspace_id, id, candidate_id),
    FOREIGN KEY(workspace_id, task_id, context_revision_id)
      REFERENCES tasks(workspace_id, id, context_revision_id)
);

CREATE TABLE files (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1),
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK(mime_type = 'application/pdf'),
    byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 5242880),
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
    object_key TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, object_key),
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE applications (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    job_key TEXT NOT NULL,
    target_id TEXT NOT NULL CHECK(target_id = 'career-evidence-demo-v1'),
    current_revision INTEGER CHECK(current_revision IS NULL OR current_revision >= 1),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, candidate_id),
    UNIQUE(workspace_id, id, target_id),
    UNIQUE(workspace_id, job_key, target_id),
    FOREIGN KEY(workspace_id, candidate_id, job_key)
      REFERENCES job_candidates(workspace_id, id, job_key),
    FOREIGN KEY(workspace_id, id, current_revision)
      REFERENCES application_revisions(workspace_id, application_id, revision)
      DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE application_revisions (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision >= 1),
    context_revision_id TEXT NOT NULL,
    brief_snapshot_id TEXT NOT NULL,
    file_id TEXT,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    draft_payload_hash TEXT NOT NULL CHECK(length(draft_payload_hash) = 64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, application_id, revision),
    FOREIGN KEY(workspace_id, application_id, candidate_id)
      REFERENCES applications(workspace_id, id, candidate_id),
    FOREIGN KEY(workspace_id, brief_snapshot_id, candidate_id, context_revision_id)
      REFERENCES brief_snapshots(workspace_id, id, candidate_id, context_revision_id),
    FOREIGN KEY(workspace_id, file_id) REFERENCES files(workspace_id, id)
);

CREATE TABLE form_sessions (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    target_id TEXT NOT NULL CHECK(target_id = 'career-evidence-demo-v1'),
    exact_origin TEXT NOT NULL,
    exact_path TEXT NOT NULL CHECK(substr(exact_path, 1, 1) = '/'),
    schema_version TEXT NOT NULL CHECK(schema_version = 'demo-form.v1'),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > created_at_ms),
    revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, application_id),
    FOREIGN KEY(workspace_id, application_id, target_id)
      REFERENCES applications(workspace_id, id, target_id)
);

CREATE TABLE approvals (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_revision INTEGER NOT NULL,
    form_session_id TEXT NOT NULL,
    -- This is the full form-bound payload hash, NOT the draft payload hash.
    approved_payload_json TEXT NOT NULL CHECK(json_valid(approved_payload_json)),
    approved_payload_hash TEXT NOT NULL CHECK(length(approved_payload_hash) = 64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > created_at_ms),
    consumed_at_ms INTEGER CHECK(consumed_at_ms IS NULL OR consumed_at_ms >= created_at_ms),
    revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, id, application_id, application_revision,
           form_session_id, approved_payload_hash),
    FOREIGN KEY(workspace_id, application_id, application_revision)
      REFERENCES application_revisions(workspace_id, application_id, revision),
    FOREIGN KEY(workspace_id, form_session_id, application_id)
      REFERENCES form_sessions(workspace_id, id, application_id)
);

CREATE TABLE submission_attempts (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_revision INTEGER NOT NULL,
    approval_id TEXT NOT NULL,
    form_session_id TEXT NOT NULL,
    approved_payload_hash TEXT NOT NULL CHECK(length(approved_payload_hash) = 64),
    state TEXT NOT NULL DEFAULT 'prepared'
      CHECK(state IN ('prepared', 'received', 'rejected', 'closed_not_accepted')),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > created_at_ms),
    terminal_at_ms INTEGER,
    reason_code TEXT,
    reason_json TEXT CHECK(reason_json IS NULL OR json_valid(reason_json)),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, approval_id),
    UNIQUE(workspace_id, id, application_id, application_revision, approved_payload_hash),
    CHECK((state = 'prepared' AND terminal_at_ms IS NULL AND reason_code IS NULL) OR
          (state = 'received' AND terminal_at_ms IS NOT NULL AND reason_code IS NULL) OR
          (state IN ('rejected', 'closed_not_accepted') AND terminal_at_ms IS NOT NULL
           AND reason_code IS NOT NULL)),
    CHECK(terminal_at_ms IS NULL OR terminal_at_ms >= created_at_ms),
    FOREIGN KEY(workspace_id, approval_id, application_id, application_revision,
                form_session_id, approved_payload_hash)
      REFERENCES approvals(workspace_id, id, application_id, application_revision,
                          form_session_id, approved_payload_hash)
);
CREATE UNIQUE INDEX one_live_or_received_attempt_per_application
  ON submission_attempts(workspace_id, application_id)
  WHERE state IN ('prepared', 'received');

CREATE TABLE test_receipts (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_revision INTEGER NOT NULL,
    attempt_id TEXT NOT NULL,
    approved_payload_hash TEXT NOT NULL CHECK(length(approved_payload_hash) = 64),
    accepted_payload_json TEXT NOT NULL CHECK(json_valid(accepted_payload_json)),
    status TEXT NOT NULL DEFAULT 'accepted' CHECK(status = 'accepted'),
    receipt_number TEXT NOT NULL UNIQUE,
    accepted_at_ms INTEGER NOT NULL CHECK(accepted_at_ms >= 0),
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, application_id),
    UNIQUE(workspace_id, attempt_id),
    FOREIGN KEY(workspace_id, attempt_id, application_id, application_revision,
                approved_payload_hash)
      REFERENCES submission_attempts(workspace_id, id, application_id,
                                     application_revision, approved_payload_hash)
);

CREATE TABLE request_keys (
    workspace_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
    status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved', 'completed')),
    resource_type TEXT,
    resource_id TEXT,
    response_status INTEGER CHECK(response_status IS NULL OR response_status BETWEEN 100 AND 599),
    response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
    PRIMARY KEY(workspace_id, operation, idempotency_key),
    CHECK((resource_type IS NULL AND resource_id IS NULL) OR
          (resource_type IS NOT NULL AND resource_id IS NOT NULL)),
    CHECK(status <> 'completed' OR resource_id IS NOT NULL OR response_json IS NOT NULL),
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

-- Workspace context revisions: append, then move the head by one in the same
-- transaction. The API must ALSO compare the caller's expected revision.
CREATE TRIGGER workspace_starts_empty BEFORE INSERT ON workspaces
WHEN NEW.revision <> 0 OR NEW.current_context_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'workspace: initialize with an empty context head'); END;

CREATE TRIGGER workspace_head_guard BEFORE UPDATE OF revision, current_context_id ON workspaces
WHEN NEW.revision IS NOT OLD.revision OR NEW.current_context_id IS NOT OLD.current_context_id
BEGIN
  SELECT CASE WHEN NEW.revision <> OLD.revision + 1 OR NOT EXISTS (
    SELECT 1 FROM context_revisions c WHERE c.workspace_id = OLD.id
      AND c.id = NEW.current_context_id AND c.revision = NEW.revision
  ) THEN RAISE(ABORT, 'workspace: invalid context head transition') END;
END;

CREATE TRIGGER context_append_guard BEFORE INSERT ON context_revisions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
      AND NEW.revision = w.revision + 1
  ) THEN RAISE(ABORT, 'context: revision must follow the current workspace head') END;
END;

-- A retry is a new task with a fixed parent. Keeping kind/context unchanged
-- makes the lineage reusable by the original search/research reservation.
-- Runtime still validates that retried items are the allowed failed subset.
CREATE TRIGGER task_retry_parent_guard BEFORE INSERT ON tasks
WHEN NEW.retry_of_task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tasks p
    WHERE p.workspace_id = NEW.workspace_id AND p.id = NEW.retry_of_task_id
      AND p.kind = NEW.kind AND p.context_revision_id = NEW.context_revision_id)
    THEN RAISE(ABORT, 'task retry: parent workspace, kind and context must match') END;
END;

CREATE TRIGGER search_task_guard BEFORE INSERT ON search_runs
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tasks t WHERE t.workspace_id = NEW.workspace_id
    AND t.id = NEW.task_id AND t.kind = 'search')
    THEN RAISE(ABORT, 'search: a search task is required') END;
  SELECT CASE WHEN NEW.selected_company_key IS NOT NULL OR NEW.research_task_id IS NOT NULL
    THEN RAISE(ABORT, 'search: reserve a research target after candidates exist') END;
END;

CREATE TRIGGER search_update_guard BEFORE UPDATE ON search_runs
BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
    OR NEW.context_revision_id IS NOT OLD.context_revision_id OR NEW.task_id IS NOT OLD.task_id
    OR NEW.query_json IS NOT OLD.query_json OR NEW.query_hash IS NOT OLD.query_hash
    OR NEW.created_at_ms IS NOT OLD.created_at_ms
    THEN RAISE(ABORT, 'search: immutable inputs') END;
  SELECT CASE WHEN OLD.selected_company_key IS NOT NULL AND
    (NEW.selected_company_key IS NOT OLD.selected_company_key OR
     NEW.research_task_id IS NOT OLD.research_task_id)
    THEN RAISE(ABORT, 'search: only one research company per run') END;
  SELECT CASE WHEN NEW.selected_company_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM job_candidates j WHERE j.workspace_id = NEW.workspace_id
      AND j.search_run_id = NEW.id AND j.company_key = NEW.selected_company_key
  ) THEN RAISE(ABORT, 'search: research company must belong to this run') END;
  SELECT CASE WHEN NEW.research_task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tasks t WHERE t.workspace_id = NEW.workspace_id
      AND t.id = NEW.research_task_id AND t.kind = 'brief'
  ) THEN RAISE(ABORT, 'search: a brief task is required') END;
  SELECT CASE WHEN OLD.sealed_at_ms IS NOT NULL AND NEW.sealed_at_ms IS NOT OLD.sealed_at_ms
    THEN RAISE(ABORT, 'search: sealed candidate set cannot be reopened') END;
END;

CREATE TRIGGER candidate_insert_guard BEFORE INSERT ON job_candidates
WHEN EXISTS (SELECT 1 FROM search_runs s WHERE s.workspace_id = NEW.workspace_id
  AND s.id = NEW.search_run_id AND s.sealed_at_ms IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'candidate: search result is sealed'); END;

CREATE TRIGGER fact_kind_guard BEFORE INSERT ON fact_bundles
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tasks t WHERE t.workspace_id = NEW.workspace_id
    AND t.id = NEW.task_id AND
      ((NEW.kind = 'job' AND t.kind = 'analysis') OR
       (NEW.kind = 'company' AND t.kind = 'brief')))
    THEN RAISE(ABORT, 'facts: task kind mismatch') END;
  SELECT CASE WHEN NEW.kind = 'company' AND NOT EXISTS (
    WITH RECURSIVE task_lineage(id, retry_of_task_id) AS (
      SELECT id, retry_of_task_id FROM tasks
        WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id
      UNION
      SELECT p.id, p.retry_of_task_id FROM tasks p JOIN task_lineage child
        ON p.id = child.retry_of_task_id
        WHERE p.workspace_id = NEW.workspace_id
    )
    SELECT 1 FROM job_candidates j JOIN search_runs s
      ON s.workspace_id = j.workspace_id AND s.id = j.search_run_id
    JOIN task_lineage lineage ON lineage.id = s.research_task_id
    WHERE j.workspace_id = NEW.workspace_id AND j.id = NEW.candidate_id
      AND s.selected_company_key = j.company_key
  ) THEN RAISE(ABORT, 'facts: company is not the reserved research target') END;
END;

CREATE TRIGGER assessment_fact_guard BEFORE INSERT ON assessments
WHEN NOT EXISTS (SELECT 1 FROM fact_bundles f WHERE f.workspace_id = NEW.workspace_id
  AND f.id = NEW.fact_bundle_id AND f.kind = 'job')
BEGIN SELECT RAISE(ABORT, 'assessment: job facts are required'); END;

CREATE TRIGGER brief_fact_guard BEFORE INSERT ON brief_snapshots
WHEN NOT EXISTS (SELECT 1 FROM fact_bundles f WHERE f.workspace_id = NEW.workspace_id
  AND f.id = NEW.company_fact_bundle_id AND f.kind = 'company')
  OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.workspace_id = NEW.workspace_id
    AND t.id = NEW.task_id AND t.kind = 'brief')
BEGIN SELECT RAISE(ABORT, 'brief: a brief task and matching company facts are required'); END;

CREATE TRIGGER application_starts_empty BEFORE INSERT ON applications
WHEN NEW.current_revision IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'application: initialize with an empty draft head'); END;

CREATE TRIGGER application_update_guard BEFORE UPDATE ON applications
BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
    OR NEW.candidate_id IS NOT OLD.candidate_id OR NEW.job_key IS NOT OLD.job_key
    OR NEW.target_id IS NOT OLD.target_id OR NEW.created_at_ms IS NOT OLD.created_at_ms
    THEN RAISE(ABORT, 'application: immutable identity') END;
  SELECT CASE WHEN NEW.current_revision IS NOT OLD.current_revision AND (
    NEW.current_revision IS NULL OR NEW.current_revision <> COALESCE(OLD.current_revision, 0) + 1
    OR NOT EXISTS (SELECT 1 FROM application_revisions r WHERE r.workspace_id = OLD.workspace_id
      AND r.application_id = OLD.id AND r.revision = NEW.current_revision)
    OR EXISTS (SELECT 1 FROM submission_attempts a WHERE a.workspace_id = OLD.workspace_id
      AND a.application_id = OLD.id AND a.state IN ('prepared', 'received'))
  ) THEN RAISE(ABORT, 'application: draft head is locked or invalid') END;
END;

CREATE TRIGGER application_revision_guard BEFORE INSERT ON application_revisions
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM applications a WHERE a.workspace_id = NEW.workspace_id
    AND a.id = NEW.application_id AND NEW.revision = COALESCE(a.current_revision, 0) + 1)
    THEN RAISE(ABORT, 'application revision: append to the current head') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM submission_attempts a WHERE a.workspace_id = NEW.workspace_id
    AND a.application_id = NEW.application_id AND a.state IN ('prepared', 'received'))
    THEN RAISE(ABORT, 'application revision: application is locked') END;
END;

CREATE TRIGGER application_head_revokes_approval AFTER UPDATE OF current_revision ON applications
WHEN NEW.current_revision IS NOT OLD.current_revision
BEGIN
  UPDATE approvals SET revoked_at_ms = NEW.updated_at_ms
    WHERE workspace_id = NEW.workspace_id AND application_id = NEW.id
      AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL;
END;

CREATE TRIGGER form_session_update_guard BEFORE UPDATE ON form_sessions
BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
    OR NEW.application_id IS NOT OLD.application_id OR NEW.target_id IS NOT OLD.target_id
    OR NEW.exact_origin IS NOT OLD.exact_origin
    OR NEW.exact_path IS NOT OLD.exact_path OR NEW.schema_version IS NOT OLD.schema_version
    OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
    OR (OLD.revoked_at_ms IS NOT NULL AND NEW.revoked_at_ms IS NOT OLD.revoked_at_ms)
    THEN RAISE(ABORT, 'form session: immutable binding or revocation') END;
END;

CREATE TRIGGER approval_insert_guard BEFORE INSERT ON approvals
BEGIN
  SELECT CASE WHEN NEW.consumed_at_ms IS NOT NULL OR NEW.revoked_at_ms IS NOT NULL
    THEN RAISE(ABORT, 'approval: must start unconsumed and unrevoked') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM applications a WHERE a.workspace_id = NEW.workspace_id
    AND a.id = NEW.application_id AND a.current_revision = NEW.application_revision)
    THEN RAISE(ABORT, 'approval: revision is not the current draft') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM application_revisions r
    WHERE r.workspace_id = NEW.workspace_id AND r.application_id = NEW.application_id
      AND r.revision = NEW.application_revision AND r.file_id IS NOT NULL)
    THEN RAISE(ABORT, 'approval: a selected synthetic file is required') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM form_sessions f WHERE f.workspace_id = NEW.workspace_id
    AND f.id = NEW.form_session_id AND f.application_id = NEW.application_id
    AND f.revoked_at_ms IS NULL AND f.created_at_ms <= NEW.created_at_ms
    AND f.expires_at_ms >= NEW.expires_at_ms)
    THEN RAISE(ABORT, 'approval: form session is invalid or expires too early') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM submission_attempts a WHERE a.workspace_id = NEW.workspace_id
    AND a.application_id = NEW.application_id AND a.state IN ('prepared', 'received'))
    THEN RAISE(ABORT, 'approval: application has an active or accepted attempt') END;
END;

CREATE TRIGGER approval_update_guard BEFORE UPDATE ON approvals
BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
    OR NEW.application_id IS NOT OLD.application_id
    OR NEW.application_revision IS NOT OLD.application_revision
    OR NEW.form_session_id IS NOT OLD.form_session_id
    OR NEW.approved_payload_json IS NOT OLD.approved_payload_json
    OR NEW.approved_payload_hash IS NOT OLD.approved_payload_hash
    OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
    OR (OLD.consumed_at_ms IS NOT NULL AND NEW.consumed_at_ms IS NOT OLD.consumed_at_ms)
    OR (OLD.revoked_at_ms IS NOT NULL AND NEW.revoked_at_ms IS NOT OLD.revoked_at_ms)
    THEN RAISE(ABORT, 'approval: only one-way consumption or revocation is mutable') END;
  SELECT CASE WHEN OLD.consumed_at_ms IS NULL AND NEW.consumed_at_ms IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM submission_attempts a WHERE a.workspace_id = NEW.workspace_id
      AND a.approval_id = NEW.id AND a.created_at_ms = NEW.consumed_at_ms)
    THEN RAISE(ABORT, 'approval: consumption requires its persisted attempt') END;
END;

CREATE TRIGGER attempt_insert_guard BEFORE INSERT ON submission_attempts
BEGIN
  SELECT CASE WHEN NEW.state <> 'prepared' THEN RAISE(ABORT, 'attempt: must begin prepared') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM approvals p JOIN applications a
      ON a.workspace_id = p.workspace_id AND a.id = p.application_id
    JOIN form_sessions f ON f.workspace_id = p.workspace_id AND f.id = p.form_session_id
    WHERE p.workspace_id = NEW.workspace_id AND p.id = NEW.approval_id
      AND p.application_id = NEW.application_id AND p.application_revision = NEW.application_revision
      AND p.form_session_id = NEW.form_session_id AND p.approved_payload_hash = NEW.approved_payload_hash
      AND a.current_revision = p.application_revision AND p.consumed_at_ms IS NULL
      AND p.revoked_at_ms IS NULL AND f.revoked_at_ms IS NULL
      AND p.created_at_ms <= NEW.created_at_ms AND p.expires_at_ms >= NEW.expires_at_ms
      AND f.expires_at_ms >= NEW.expires_at_ms
  ) THEN RAISE(ABORT, 'attempt: approval binding is stale, consumed, revoked or expired') END;
END;

CREATE TRIGGER attempt_consumes_approval AFTER INSERT ON submission_attempts
BEGIN
  UPDATE approvals SET consumed_at_ms = NEW.created_at_ms
    WHERE workspace_id = NEW.workspace_id AND id = NEW.approval_id;
  UPDATE approvals SET revoked_at_ms = NEW.created_at_ms
    WHERE workspace_id = NEW.workspace_id AND application_id = NEW.application_id
      AND id <> NEW.approval_id AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL;
END;

CREATE TRIGGER attempt_update_guard BEFORE UPDATE ON submission_attempts
BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
    OR NEW.application_id IS NOT OLD.application_id
    OR NEW.application_revision IS NOT OLD.application_revision
    OR NEW.approval_id IS NOT OLD.approval_id OR NEW.form_session_id IS NOT OLD.form_session_id
    OR NEW.approved_payload_hash IS NOT OLD.approved_payload_hash
    OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
    THEN RAISE(ABORT, 'attempt: immutable identity and approval binding') END;
  SELECT CASE WHEN OLD.state <> 'prepared' THEN RAISE(ABORT, 'attempt: terminal result is immutable') END;
  SELECT CASE WHEN NEW.state = 'received' AND NOT EXISTS (SELECT 1 FROM test_receipts r
    WHERE r.workspace_id = NEW.workspace_id AND r.attempt_id = NEW.id)
    THEN RAISE(ABORT, 'attempt: received requires a receipt') END;
  SELECT CASE WHEN NEW.state IN ('rejected', 'closed_not_accepted') AND EXISTS (
    SELECT 1 FROM test_receipts r WHERE r.workspace_id = NEW.workspace_id AND r.attempt_id = NEW.id)
    THEN RAISE(ABORT, 'attempt: an accepted attempt cannot be closed') END;
END;

-- Receipt creation and attempt acceptance happen in the same transaction.
-- Reconcile may terminalize a still-prepared attempt as closed_not_accepted
-- ONLY while holding the same SQLite write transaction used by the receiver.
-- Its no-receipt read + attempt closure must be atomic (BEGIN IMMEDIATE). A late
-- receiver sees the terminal state and is rejected by this trigger.
CREATE TRIGGER receipt_insert_guard BEFORE INSERT ON test_receipts
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM test_receipts r WHERE r.workspace_id = NEW.workspace_id
    AND r.application_id = NEW.application_id)
    THEN RAISE(ABORT, 'receipt: application already accepted') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM submission_attempts a JOIN approvals p
      ON p.workspace_id = a.workspace_id AND p.id = a.approval_id
    JOIN form_sessions f ON f.workspace_id = a.workspace_id AND f.id = a.form_session_id
    WHERE a.workspace_id = NEW.workspace_id AND a.id = NEW.attempt_id
      AND a.application_id = NEW.application_id AND a.application_revision = NEW.application_revision
      AND a.approved_payload_hash = NEW.approved_payload_hash AND a.state = 'prepared'
      AND a.created_at_ms <= NEW.accepted_at_ms AND a.expires_at_ms > NEW.accepted_at_ms
      AND p.revoked_at_ms IS NULL AND p.expires_at_ms > NEW.accepted_at_ms
      AND f.revoked_at_ms IS NULL AND f.expires_at_ms > NEW.accepted_at_ms
  ) THEN RAISE(ABORT, 'receipt: attempt is not an eligible prepared submission') END;
END;

CREATE TRIGGER receipt_accepts_attempt AFTER INSERT ON test_receipts
BEGIN
  UPDATE submission_attempts SET state = 'received', terminal_at_ms = NEW.accepted_at_ms,
    updated_at_ms = NEW.accepted_at_ms WHERE workspace_id = NEW.workspace_id AND id = NEW.attempt_id;
END;

CREATE TRIGGER task_input_immutable BEFORE UPDATE ON tasks
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.context_revision_id IS NOT OLD.context_revision_id OR NEW.kind IS NOT OLD.kind
  OR NEW.retry_of_task_id IS NOT OLD.retry_of_task_id
  OR NEW.input_json IS NOT OLD.input_json OR NEW.input_hash IS NOT OLD.input_hash
  OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.lease_generation < OLD.lease_generation
BEGIN SELECT RAISE(ABORT, 'task: immutable input or decreasing lease generation'); END;

CREATE TRIGGER provider_input_immutable BEFORE UPDATE ON provider_calls
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.task_id IS NOT OLD.task_id OR NEW.call_number IS NOT OLD.call_number
  OR NEW.lease_generation IS NOT OLD.lease_generation OR NEW.provider IS NOT OLD.provider
  OR NEW.endpoint IS NOT OLD.endpoint OR NEW.request_json IS NOT OLD.request_json
  OR NEW.request_hash IS NOT OLD.request_hash OR NEW.created_at_ms IS NOT OLD.created_at_ms
BEGIN SELECT RAISE(ABORT, 'provider call: immutable request identity'); END;

CREATE TRIGGER request_key_update_guard BEFORE UPDATE ON request_keys
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.operation IS NOT OLD.operation
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.created_at_ms IS NOT OLD.created_at_ms OR OLD.status = 'completed'
BEGIN SELECT RAISE(ABORT, 'request key: immutable identity or completed result'); END;

-- Immutable evidence and submitted content. Deletion is intentionally absent
-- from this demonstration contract; data retention/deletion needs its own design.
CREATE TRIGGER context_revisions_no_update BEFORE UPDATE ON context_revisions
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: context_revisions'); END;
CREATE TRIGGER context_revisions_no_delete BEFORE DELETE ON context_revisions
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: context_revisions'); END;
CREATE TRIGGER job_candidates_no_update BEFORE UPDATE ON job_candidates
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: job_candidates'); END;
CREATE TRIGGER job_candidates_no_delete BEFORE DELETE ON job_candidates
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: job_candidates'); END;
CREATE TRIGGER fact_bundles_no_update BEFORE UPDATE ON fact_bundles
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: fact_bundles'); END;
CREATE TRIGGER fact_bundles_no_delete BEFORE DELETE ON fact_bundles
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: fact_bundles'); END;
CREATE TRIGGER assessments_no_update BEFORE UPDATE ON assessments
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: assessments'); END;
CREATE TRIGGER assessments_no_delete BEFORE DELETE ON assessments
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: assessments'); END;
CREATE TRIGGER brief_snapshots_no_update BEFORE UPDATE ON brief_snapshots
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: brief_snapshots'); END;
CREATE TRIGGER brief_snapshots_no_delete BEFORE DELETE ON brief_snapshots
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: brief_snapshots'); END;
CREATE TRIGGER files_no_update BEFORE UPDATE ON files
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: files'); END;
CREATE TRIGGER files_no_delete BEFORE DELETE ON files
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: files'); END;
CREATE TRIGGER application_revisions_no_update BEFORE UPDATE ON application_revisions
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: application_revisions'); END;
CREATE TRIGGER application_revisions_no_delete BEFORE DELETE ON application_revisions
BEGIN SELECT RAISE(ABORT, 'immutable snapshot: application_revisions'); END;
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals
BEGIN SELECT RAISE(ABORT, 'immutable history: approvals'); END;
CREATE TRIGGER submission_attempts_no_delete BEFORE DELETE ON submission_attempts
BEGIN SELECT RAISE(ABORT, 'immutable history: submission_attempts'); END;
CREATE TRIGGER test_receipts_no_update BEFORE UPDATE ON test_receipts
BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
CREATE TRIGGER test_receipts_no_delete BEFORE DELETE ON test_receipts
BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;

COMMIT;
