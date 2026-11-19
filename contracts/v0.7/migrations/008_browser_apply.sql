-- Career Evidence v0.7.1 additive migration: S05 browser apply (DECISIONS S5-01).
-- 007_resume_workflow.sql is never edited. No BEGIN/COMMIT here: the runner owns the transaction.
-- ce8_*: executor device pairing, form observations/readback, per-attempt run tokens, user-recorded
-- external applications. demo_site_*: the self-hosted test form SITE's own receipt store. It is the
-- site's record, not product evidence, and has no workspace column (a site does not know our workspaces).

CREATE TABLE ce8_executor_devices (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,
executor TEXT NOT NULL CHECK(executor IN ('chrome','ego')),
label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
created_at_ms INTEGER NOT NULL, last_seen_at_ms INTEGER NOT NULL, revoked_at_ms INTEGER,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id)
);

CREATE TABLE ce8_executor_pairings (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,
executor TEXT NOT NULL CHECK(executor IN ('chrome','ego')),
code_hash TEXT NOT NULL UNIQUE CHECK(length(code_hash)=64 AND code_hash NOT GLOB '*[^0-9a-f]*'),
created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms),
used_at_ms INTEGER, device_id TEXT,
CHECK((used_at_ms IS NULL AND device_id IS NULL) OR (used_at_ms IS NOT NULL AND device_id IS NOT NULL)),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,device_id) REFERENCES ce8_executor_devices(workspace_id,id)
);

CREATE TABLE ce8_form_observations (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,
application_id TEXT NOT NULL, application_revision INTEGER NOT NULL,
payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
device_id TEXT NOT NULL, account_binding_id TEXT NOT NULL,
executor TEXT NOT NULL CHECK(executor IN ('chrome','ego')), site_id TEXT NOT NULL, adapter_version TEXT NOT NULL,
target_url TEXT NOT NULL, document_id TEXT NOT NULL CHECK(length(document_id) BETWEEN 1 AND 128),
form_snapshot_hash TEXT NOT NULL CHECK(length(form_snapshot_hash)=64 AND form_snapshot_hash NOT GLOB '*[^0-9a-f]*'),
snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
issues_json TEXT NOT NULL CHECK(json_valid(issues_json)),
readback_json TEXT CHECK(readback_json IS NULL OR json_valid(readback_json)),
state TEXT NOT NULL CHECK(state IN ('inspected','verified','mismatch')),
created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
CHECK(state <> 'verified' OR readback_json IS NOT NULL),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,application_id,application_revision,payload_hash) REFERENCES ce7_application_revisions(workspace_id,application_id,revision,payload_hash),
FOREIGN KEY(workspace_id,device_id) REFERENCES ce8_executor_devices(workspace_id,id),
FOREIGN KEY(workspace_id,account_binding_id,executor,site_id) REFERENCES ce7_account_bindings(workspace_id,id,executor,site_id)
);

CREATE INDEX ce8_form_observations_application ON ce8_form_observations(workspace_id,application_id,created_at_ms);

CREATE TABLE ce8_attempt_runs (
attempt_id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,
device_id TEXT NOT NULL,
run_token_hash TEXT NOT NULL UNIQUE CHECK(length(run_token_hash)=64 AND run_token_hash NOT GLOB '*[^0-9a-f]*'),
claimed_at_ms INTEGER NOT NULL, dispatched_at_ms INTEGER, reported_at_ms INTEGER,
report_json TEXT CHECK(report_json IS NULL OR json_valid(report_json)),
CHECK(reported_at_ms IS NULL OR report_json IS NOT NULL),
FOREIGN KEY(workspace_id,attempt_id) REFERENCES ce7_attempts(workspace_id,id),
FOREIGN KEY(workspace_id,device_id) REFERENCES ce8_executor_devices(workspace_id,id)
);

CREATE TABLE ce8_external_applications (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,
job_snapshot_id TEXT, job_key TEXT,
company_name TEXT NOT NULL CHECK(length(company_name) BETWEEN 1 AND 100),
title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
channel TEXT NOT NULL CHECK(length(channel) BETWEEN 1 AND 60),
applied_on TEXT NOT NULL CHECK(applied_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
note TEXT NOT NULL CHECK(length(note) <= 500),
created_at_ms INTEGER NOT NULL,
CHECK((job_snapshot_id IS NULL AND job_key IS NULL) OR (job_snapshot_id IS NOT NULL AND job_key IS NOT NULL)),
UNIQUE(workspace_id,id), UNIQUE(workspace_id,job_key),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,job_snapshot_id,job_key) REFERENCES ce7_job_snapshots(workspace_id,id,job_key)
);

CREATE TABLE demo_site_submissions (
submission_key TEXT NOT NULL PRIMARY KEY CHECK(length(submission_key) BETWEEN 1 AND 128),
posting_id TEXT NOT NULL,
state TEXT NOT NULL CHECK(state IN ('accepted','sealed')),
receipt_number TEXT UNIQUE,
fields_json TEXT CHECK(fields_json IS NULL OR json_valid(fields_json)),
file_name TEXT, file_size INTEGER, file_sha256 TEXT CHECK(file_sha256 IS NULL OR (length(file_sha256)=64 AND file_sha256 NOT GLOB '*[^0-9a-f]*')),
created_at_ms INTEGER NOT NULL,
CHECK((state='accepted' AND receipt_number IS NOT NULL AND fields_json IS NOT NULL AND file_name IS NOT NULL AND file_size>0 AND file_sha256 IS NOT NULL)
  OR (state='sealed' AND receipt_number IS NULL AND fields_json IS NULL AND file_name IS NULL AND file_size IS NULL AND file_sha256 IS NULL))
);

CREATE TRIGGER demo_site_submissions_immutable BEFORE UPDATE ON demo_site_submissions BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_RECORD');
END;
