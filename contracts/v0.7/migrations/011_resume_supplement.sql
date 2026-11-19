-- Career Evidence v0.7.4 migration: 기본 이력서 보완 대화(supplement_resume) 작업과 대화 표 (DECISIONS S1-16).
-- 007~010 are never edited. No BEGIN/COMMIT here: the runner owns the transaction.
-- ce7_tasks is rebuilt exactly like 010 (same columns, keys, foreign keys and index); only kind gains 'supplement_resume'.
-- Rows are copied back into the renamed table AFTER the drop so the parent inserts clear the deferred violations
-- the drop counted (lesson L4). defer_foreign_keys resets at commit.
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE ce7_tasks_rows AS SELECT * FROM ce7_tasks;

CREATE TABLE ce7_tasks_v074 (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

kind TEXT NOT NULL CHECK(kind IN ('extract_resume','search_jobs','tailor_resume','render_resume','discover_similar','prepare_application','submit_application','review_resume','supplement_resume')),
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

DROP TABLE ce7_tasks;
ALTER TABLE ce7_tasks_v074 RENAME TO ce7_tasks;

INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
SELECT id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms FROM temp.ce7_tasks_rows;
DROP TABLE temp.ce7_tasks_rows;

CREATE INDEX ce7_tasks_ready ON ce7_tasks(state,available_at_ms);

-- 보완 대화 세션. 시작한 확정 경력 버전(fact_revision_id)에 묶인다. 대화 내용은 경력 사실이 아니며,
-- 사용자가 쓴 메시지(role=user)만 기존 확정 API에서 user_statement 근거가 될 수 있다.
CREATE TABLE ce8_supplement_sessions (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,
document_id TEXT NOT NULL,
fact_revision_id TEXT NOT NULL,
provider_mode TEXT NOT NULL CHECK(provider_mode IN ('mock','live')),
state TEXT NOT NULL CHECK(state IN ('open','closed')),
created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,document_id) REFERENCES ce7_documents(workspace_id,id),
FOREIGN KEY(workspace_id,fact_revision_id) REFERENCES ce7_fact_revisions(workspace_id,id)
);

CREATE INDEX ce8_supplement_sessions_document ON ce8_supplement_sessions(workspace_id,document_id,created_at_ms);

CREATE TRIGGER ce8_supplement_sessions_identity BEFORE UPDATE ON ce8_supplement_sessions
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.document_id IS NOT OLD.document_id OR NEW.fact_revision_id IS NOT OLD.fact_revision_id OR NEW.provider_mode IS NOT OLD.provider_mode OR NEW.created_at_ms IS NOT OLD.created_at_ms
BEGIN SELECT RAISE(ABORT,'SUPPLEMENT_SESSION_IDENTITY'); END;

-- 대화 메시지. assistant 메시지는 작업 결과(거른 점검·후보·초안·질문)를 result_json에 담는다. 저장 후 바꾸지 않는다.
CREATE TABLE ce8_supplement_messages (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,
session_id TEXT NOT NULL,
role TEXT NOT NULL CHECK(role IN ('user','assistant')),
content TEXT NOT NULL,
result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
task_id TEXT,
created_at_ms INTEGER NOT NULL,
CHECK((role='user' AND result_json IS NULL) OR (role='assistant' AND result_json IS NOT NULL AND task_id IS NOT NULL)),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,session_id) REFERENCES ce8_supplement_sessions(workspace_id,id),
FOREIGN KEY(workspace_id,task_id) REFERENCES ce7_tasks(workspace_id,id)
);

CREATE INDEX ce8_supplement_messages_session ON ce8_supplement_messages(workspace_id,session_id,created_at_ms);

CREATE TRIGGER ce8_supplement_messages_immutable BEFORE UPDATE ON ce8_supplement_messages
BEGIN SELECT RAISE(ABORT,'SUPPLEMENT_MESSAGE_IMMUTABLE'); END;
