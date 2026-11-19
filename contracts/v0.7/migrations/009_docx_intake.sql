-- Career Evidence v0.7.2 migration: Word(.docx) resume originals (DECISIONS S1-12).
-- 007/008 are never edited. No BEGIN/COMMIT here: the runner owns the transaction.
-- SQLite cannot change a CHECK in place, so ce7_documents is rebuilt with the same columns, keys,
-- foreign keys and triggers. Only input_kind/mime_type gain 'docx' and the Word MIME type.
-- Child rows (extractions, fact revisions) keep the same ids. defer_foreign_keys moves the foreign-key
-- check to commit (it resets there). Rows are copied back into the renamed table AFTER the drop so the
-- parent inserts clear the deferred violations the drop counted; a copy made before the drop would not.
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE ce7_documents_rows AS SELECT * FROM ce7_documents;

CREATE TABLE ce7_documents_v072 (
id TEXT NOT NULL PRIMARY KEY,
workspace_id TEXT NOT NULL,

input_kind TEXT NOT NULL CHECK(input_kind IN ('text_pdf','pasted_text','docx')),
filename TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
byte_size INTEGER NOT NULL CHECK(byte_size>0), sha256 TEXT NOT NULL CHECK(sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*')), object_key TEXT NOT NULL,
data_origin TEXT NOT NULL CHECK(data_origin IN ('user','synthetic')),
extraction_status TEXT NOT NULL CHECK(extraction_status IN ('uploaded','extracting','review_required','extracted','failed')),
error_code TEXT, current_fact_revision_id TEXT, created_at_ms INTEGER NOT NULL,
CHECK((input_kind='text_pdf' AND mime_type='application/pdf') OR (input_kind='pasted_text' AND mime_type='text/plain') OR (input_kind='docx' AND mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
UNIQUE(workspace_id,object_key), UNIQUE(workspace_id,id,sha256),
UNIQUE(workspace_id,id),
FOREIGN KEY(workspace_id) REFERENCES ce7_workspace_owners(workspace_id),
FOREIGN KEY(workspace_id,current_fact_revision_id,id) REFERENCES ce7_fact_revisions(workspace_id,id,document_id) DEFERRABLE INITIALLY DEFERRED
);

DROP TABLE ce7_documents;
ALTER TABLE ce7_documents_v072 RENAME TO ce7_documents;

INSERT INTO ce7_documents (id, workspace_id, input_kind, filename, mime_type, byte_size, sha256, object_key, data_origin, extraction_status, error_code, current_fact_revision_id, created_at_ms)
SELECT id, workspace_id, input_kind, filename, mime_type, byte_size, sha256, object_key, data_origin, extraction_status, error_code, current_fact_revision_id, created_at_ms FROM temp.ce7_documents_rows;
DROP TABLE temp.ce7_documents_rows;

CREATE TRIGGER ce7_documents_identity BEFORE UPDATE ON ce7_documents WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.input_kind IS NOT OLD.input_kind OR NEW.filename IS NOT OLD.filename OR NEW.mime_type IS NOT OLD.mime_type OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.object_key IS NOT OLD.object_key OR NEW.data_origin IS NOT OLD.data_origin OR NEW.created_at_ms IS NOT OLD.created_at_ms BEGIN
SELECT RAISE(ABORT,'IMMUTABLE_PAYLOAD');
END;

CREATE TRIGGER ce7_real_document_owner BEFORE INSERT ON ce7_documents
WHEN NEW.data_origin='user' AND NOT EXISTS(SELECT 1 FROM ce7_workspace_owners o JOIN ce7_principals p ON p.id=o.principal_id WHERE o.workspace_id=NEW.workspace_id AND p.mode='authenticated')
BEGIN SELECT RAISE(ABORT,'AUTHENTICATED_OWNER_REQUIRED'); END;
