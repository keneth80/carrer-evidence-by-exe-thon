"""Real SQLite constraint checks for the v0.4 migration candidate.

Run from the package directory:
    PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests -v

These tests do not implement or certify HTTP authorization, Chrome integration,
Liner calls, JSON-schema validation, canonical hash validation, worker fencing,
runtime clock checks, or idempotency replay. In particular, three selections per
analysis request and same-key/different-request HTTP behavior belong to the API.
All databases are in memory; all profiles, companies and files are synthetic.
"""

import hashlib
import json
from pathlib import Path
import sqlite3
import unittest


SCHEMA = Path(__file__).resolve().parents[1] / "schema.sql"
TARGET = "career-evidence-demo-v1"


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    if not isinstance(value, str):
        value = encode(value)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class DatabaseConstraintTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:", isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA.read_text(encoding="utf-8"))
        self.sequence = 0
        self.clock = 1_700_000_000_000

    def tearDown(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.db.close()

    def ident(self, label):
        self.sequence += 1
        return f"{label}-{self.sequence}"

    def now(self):
        self.clock += 10
        return self.clock

    def insert(self, table, values):
        columns = ", ".join(values)
        placeholders = ", ".join("?" for _ in values)
        self.db.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                        tuple(values.values()))
        return values

    def row(self, table, identifier):
        return dict(self.db.execute(f"SELECT * FROM {table} WHERE id = ?", (identifier,)).fetchone())

    def workspace(self):
        wid = self.ident("workspace")
        stamp = self.now()
        self.insert("workspaces", {
            "id": wid, "session_token_hash": digest("session:" + wid),
            "csrf_token_hash": digest("csrf:" + wid),
            "expires_at_ms": stamp + 604_800_000,
            "created_at_ms": stamp, "updated_at_ms": stamp,
        })
        context = self.context(wid)
        return {"workspace_id": wid, "context_id": context["id"]}

    def context(self, workspace_id):
        head = self.row("workspaces", workspace_id)
        revision = head["revision"] + 1
        profile = {"id": "synthetic-jiwon", "years": 8, "react_years": 6}
        conditions = {"remote": {"importance": "required", "value": True}}
        result = self.insert("context_revisions", {
            "id": self.ident("context"), "workspace_id": workspace_id,
            "revision": revision, "profile_id": "synthetic-jiwon", "profile_revision": 1,
            "profile_json": encode(profile), "conditions_json": encode(conditions),
            "content_hash": digest({"profile": profile, "conditions": conditions}),
            "created_at_ms": self.now(),
        })
        self.db.execute("UPDATE workspaces SET revision=?, current_context_id=?, updated_at_ms=? WHERE id=?",
                        (revision, result["id"], self.now(), workspace_id))
        return result

    def task(self, scope, kind, input_value=None, **overrides):
        stamp = self.now()
        payload = input_value if input_value is not None else {"kind": kind}
        values = {
            "id": self.ident("task"), "workspace_id": scope["workspace_id"],
            "context_revision_id": scope["context_id"], "kind": kind,
            "input_json": encode(payload), "input_hash": digest(payload),
            "available_at_ms": stamp, "created_at_ms": stamp, "updated_at_ms": stamp,
        }
        values.update(overrides)
        return self.insert("tasks", values)

    def search_scope(self):
        scope = self.workspace()
        task = self.task(scope, "search")
        run = self.insert("search_runs", {
            "id": self.ident("search"), "workspace_id": scope["workspace_id"],
            "context_revision_id": scope["context_id"], "task_id": task["id"],
            "query_json": encode({"role": "frontend"}), "query_hash": digest("frontend"),
            "created_at_ms": self.now(),
        })
        scope.update({"search_run_id": run["id"], "company_key": self.ident("company")})
        return scope

    def candidate(self, scope, slot=1, **overrides):
        key = self.ident("job")
        values = {
            "id": self.ident("candidate"), "workspace_id": scope["workspace_id"],
            "search_run_id": scope["search_run_id"], "candidate_slot": slot,
            "job_key": key, "company_key": scope["company_key"],
            "company_name": "루미노랩 (가상)", "job_title": "프론트엔드 개발 리드",
            "source_url": "https://careers.lumino.example/" + key,
            "snapshot_json": encode({"is_synthetic": True, "job_key": key}),
            "collected_at_ms": self.now(),
        }
        values.update(overrides)
        return self.insert("job_candidates", values)

    def application(self, scope=None, slot=1):
        scope = dict(scope or self.search_scope())
        candidate = self.candidate(scope, slot)
        analysis = self.task(scope, "analysis", {"candidate_ids": [candidate["id"]]})
        job_facts = self.insert("fact_bundles", {
            "id": self.ident("facts"), "workspace_id": scope["workspace_id"],
            "candidate_id": candidate["id"], "task_id": analysis["id"],
            "kind": "job", "data_origin": "fixture", "sources_json": "[]",
            "claims_json": encode([{"field": "remote", "state": "known", "value": True}]),
            "content_hash": digest("fixture-job-facts"), "created_at_ms": self.now(),
        })
        assessment = self.insert("assessments", {
            "id": self.ident("assessment"), "workspace_id": scope["workspace_id"],
            "candidate_id": candidate["id"], "context_revision_id": scope["context_id"],
            "fact_bundle_id": job_facts["id"], "ruleset_version": "match.v1",
            "decision": "review", "result_json": encode({"remote": "satisfied"}),
            "content_hash": digest("fixture-assessment"), "created_at_ms": self.now(),
        })
        run = self.row("search_runs", scope["search_run_id"])
        if run["research_task_id"] is None:
            research = self.task(scope, "brief")
            self.db.execute("UPDATE search_runs SET selected_company_key=?, research_task_id=? WHERE id=?",
                            (scope["company_key"], research["id"], scope["search_run_id"]))
        else:
            research = self.row("tasks", run["research_task_id"])
        company_facts = self.insert("fact_bundles", {
            "id": self.ident("facts"), "workspace_id": scope["workspace_id"],
            "candidate_id": candidate["id"], "task_id": research["id"],
            "kind": "company", "data_origin": "fixture", "sources_json": "[]",
            "claims_json": "[]", "content_hash": digest("fixture-company-facts"),
            "created_at_ms": self.now(),
        })
        brief = self.insert("brief_snapshots", {
            "id": self.ident("brief"), "workspace_id": scope["workspace_id"],
            "candidate_id": candidate["id"], "context_revision_id": scope["context_id"],
            "assessment_id": assessment["id"], "company_fact_bundle_id": company_facts["id"],
            "task_id": research["id"], "body_json": encode({"reasons": ["React 경험"]}),
            "content_hash": digest("fixture-brief"), "created_at_ms": self.now(),
        })
        file_id = self.ident("file")
        self.insert("files", {
            "id": file_id, "workspace_id": scope["workspace_id"],
            "original_filename": "김지원_샘플이력서.pdf", "mime_type": "application/pdf",
            "byte_size": 1024, "sha256": digest("synthetic-pdf-bytes"),
            "object_key": "synthetic/" + file_id, "created_at_ms": self.now(),
        })
        application_id = self.ident("application")
        stamp = self.now()
        self.insert("applications", {
            "id": application_id, "workspace_id": scope["workspace_id"],
            "candidate_id": candidate["id"], "job_key": candidate["job_key"], "target_id": TARGET,
            "created_at_ms": stamp, "updated_at_ms": stamp,
        })
        scope.update({"candidate_id": candidate["id"], "job_key": candidate["job_key"],
                      "application_id": application_id, "file_id": file_id,
                      "brief_id": brief["id"], "assessment_id": assessment["id"],
                      "job_facts_id": job_facts["id"], "company_facts_id": company_facts["id"],
                      "analysis_task_id": analysis["id"], "research_task_id": research["id"]})
        self.append_revision(scope)
        return scope

    def append_revision(self, graph, **overrides):
        app = self.row("applications", graph["application_id"])
        revision = (app["current_revision"] or 0) + 1
        payload = {"schema_version": "application.v1", "answers": {"experience": "React 화면 개발"},
                   "start": "합격 후 4주", "file_id": graph["file_id"],
                   "consent": {"version": "demo-consent.v1", "accepted": True}}
        values = {
            "id": self.ident("draft"), "workspace_id": graph["workspace_id"],
            "application_id": graph["application_id"], "candidate_id": graph["candidate_id"],
            "revision": revision, "context_revision_id": graph["context_id"],
            "brief_snapshot_id": graph["brief_id"], "file_id": graph["file_id"],
            "payload_json": encode(payload), "draft_payload_hash": digest(payload),
            "created_at_ms": self.now(),
        }
        values.update(overrides)
        self.insert("application_revisions", values)
        self.db.execute("UPDATE applications SET current_revision=?, updated_at_ms=? WHERE id=?",
                        (revision, self.now(), graph["application_id"]))
        graph.update({"revision": revision, "revision_id": values["id"]})
        return values

    def form_session(self, graph, **overrides):
        fid = self.ident("form")
        stamp = self.now()
        values = {
            "id": fid, "workspace_id": graph["workspace_id"], "application_id": graph["application_id"],
            "target_id": TARGET,
            "exact_origin": "http://127.0.0.1:4173", "exact_path": "/demo/apply",
            "schema_version": "demo-form.v1", "created_at_ms": stamp,
            "expires_at_ms": stamp + 1_000_000,
        }
        values.update(overrides)
        return self.insert("form_sessions", values)

    def approval(self, graph, form=None, **overrides):
        form = form or self.form_session(graph)
        draft = self.row("application_revisions", graph["revision_id"])
        file = self.row("files", graph["file_id"])
        payload = {
            "schema_version": "application.v1", "application_id": graph["application_id"],
            "revision": graph["revision"], "target_id": TARGET, "form_session_id": form["id"],
            "form": {"origin": form["exact_origin"], "path": form["exact_path"],
                     "schema_version": form["schema_version"]},
            "company": {"key": graph["company_key"], "name": "루미노랩 (가상)"},
            "job": {"key": graph["job_key"], "title": "프론트엔드 개발 리드"},
            "profile": {"id": "synthetic-jiwon", "revision": 1, "name": "김지원"},
            "draft": json.loads(draft["payload_json"]),
            "file": {"id": file["id"], "sha256": file["sha256"]},
            "consent": {"version": "demo-consent.v1", "accepted": True},
        }
        values = {
            "id": self.ident("approval"), "workspace_id": graph["workspace_id"],
            "application_id": graph["application_id"], "application_revision": graph["revision"],
            "form_session_id": form["id"], "approved_payload_json": encode(payload),
            "approved_payload_hash": digest(payload), "created_at_ms": self.now(),
            "expires_at_ms": form["expires_at_ms"] - 100,
        }
        values.update(overrides)
        return self.insert("approvals", values)

    def attempt(self, graph, approval, **overrides):
        attempt_id = self.ident("attempt")
        stamp = self.now()
        values = {
            "id": attempt_id, "workspace_id": graph["workspace_id"],
            "application_id": graph["application_id"],
            "application_revision": approval["application_revision"],
            "approval_id": approval["id"], "form_session_id": approval["form_session_id"],
            "approved_payload_hash": approval["approved_payload_hash"],
            "created_at_ms": stamp, "updated_at_ms": stamp,
            "expires_at_ms": approval["expires_at_ms"] - 1,
        }
        values.update(overrides)
        return self.insert("submission_attempts", values)

    def receipt(self, attempt, **overrides):
        approval = self.row("approvals", attempt["approval_id"])
        rid = self.ident("receipt")
        values = {
            "id": rid, "workspace_id": attempt["workspace_id"],
            "application_id": attempt["application_id"],
            "application_revision": attempt["application_revision"],
            "attempt_id": attempt["id"], "approved_payload_hash": attempt["approved_payload_hash"],
            "accepted_payload_json": approval["approved_payload_json"],
            "receipt_number": "DEMO-" + rid, "accepted_at_ms": self.now(),
        }
        values.update(overrides)
        return self.insert("test_receipts", values)

    def close_attempt(self, attempt, state="closed_not_accepted"):
        stamp = self.now()
        self.db.execute("UPDATE submission_attempts SET state=?, terminal_at_ms=?, updated_at_ms=?, "
                        "reason_code=?, reason_json=? WHERE id=?",
                        (state, stamp, stamp, "NOT_ACCEPTED" if state == "closed_not_accepted" else "INVALID_FIELD",
                         encode({"message": "synthetic result"}), attempt["id"]))

    def test_schema_has_seventeen_tables_and_enabled_foreign_keys(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0], 17)

    def test_workspace_expiry_and_nonnegative_budget(self):
        scope = self.workspace()
        row = self.row("workspaces", scope["workspace_id"])
        self.assertEqual(row["expires_at_ms"] - row["created_at_ms"], 604_800_000)
        self.assertEqual(row["budget_limit_micro_usd"], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE workspaces SET expires_at_ms=created_at_ms WHERE id=?", (row["id"],))
        for invalid in (-1, 1.5):
            with self.subTest(budget=invalid), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE workspaces SET budget_limit_micro_usd=? WHERE id=?", (invalid, row["id"]))

    def test_retry_lineage_preserves_scope_and_reserved_research_target(self):
        graph = self.application()
        first_retry = self.task(graph, "brief", retry_of_task_id=graph["research_task_id"])
        second_retry = self.task(graph, "brief", retry_of_task_id=first_retry["id"])
        facts = self.row("fact_bundles", graph["company_facts_id"])
        facts.update({"id": self.ident("facts"), "task_id": second_retry["id"]})
        self.insert("fact_bundles", facts)
        brief = self.row("brief_snapshots", graph["brief_id"])
        brief.update({"id": self.ident("brief"), "task_id": second_retry["id"],
                      "company_fact_bundle_id": facts["id"]})
        self.insert("brief_snapshots", brief)
        self.assertEqual(self.row("search_runs", graph["search_run_id"])["research_task_id"], graph["research_task_id"])
        unrelated = self.task(graph, "brief")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("fact_bundles", {**facts, "id": self.ident("facts"), "task_id": unrelated["id"]})
        with self.assertRaises(sqlite3.IntegrityError):
            self.task(graph, "analysis", retry_of_task_id=first_retry["id"])
        other_scope = self.workspace()
        with self.assertRaises(sqlite3.IntegrityError):
            self.task(other_scope, "brief", retry_of_task_id=first_retry["id"])
        newer_context = self.context(graph["workspace_id"])
        with self.assertRaises(sqlite3.IntegrityError):
            self.task({**graph, "context_id": newer_context["id"]}, "brief", retry_of_task_id=first_retry["id"])
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tasks SET retry_of_task_id=? WHERE id=?", (unrelated["id"], second_retry["id"]))

    def test_task_cancel_flag_and_outcome_contract(self):
        scope = self.workspace()
        task = self.task(scope, "search")
        self.assertEqual(self.row("tasks", task["id"])["cancel_requested"], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tasks SET cancel_requested=2 WHERE id=?", (task["id"],))
        self.db.execute("UPDATE tasks SET cancel_requested=1 WHERE id=?", (task["id"],))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tasks SET outcome='partial' WHERE id=?", (task["id"],))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tasks SET state='succeeded' WHERE id=?", (task["id"],))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tasks SET state='succeeded', outcome='unknown' WHERE id=?", (task["id"],))
        self.db.execute("UPDATE tasks SET state='succeeded', outcome='empty' WHERE id=?", (task["id"],))
        self.assertEqual(self.row("tasks", task["id"])["outcome"], "empty")

    def test_provider_billing_fields_and_verified_cost(self):
        scope = self.workspace()
        task = self.task(scope, "search")
        stamp = self.now()
        call = self.insert("provider_calls", {
            "id": self.ident("call"), "workspace_id": scope["workspace_id"],
            "task_id": task["id"], "call_number": 1, "lease_generation": 1,
            "endpoint": "/api/v1/tools/search/web", "request_json": "{}", "request_hash": digest({}),
            "created_at_ms": stamp, "updated_at_ms": stamp,
        })
        self.assertEqual(self.row("provider_calls", call["id"])["billing_status"], "not_dispatched")
        for invalid in (-1, 1.5):
            with self.subTest(estimated_cost=invalid), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE provider_calls SET estimated_cost_micro_usd=? WHERE id=?", (invalid, call["id"]))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE provider_calls SET billing_status='verified' WHERE id=?", (call["id"],))
        self.db.execute("UPDATE provider_calls SET estimated_cost_micro_usd=1000, billing_status='estimated' WHERE id=?", (call["id"],))
        self.db.execute("UPDATE provider_calls SET billing_status='unknown' WHERE id=?", (call["id"],))
        self.db.execute("UPDATE provider_calls SET billing_status='verified', verified_cost_micro_usd=0 WHERE id=?", (call["id"],))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE provider_calls SET verified_cost_micro_usd=-1 WHERE id=?", (call["id"],))

    def test_full_payload_hash_is_distinct_and_receipt_accepts_attempt(self):
        graph = self.application()
        approval = self.approval(graph)
        draft = self.row("application_revisions", graph["revision_id"])
        self.assertNotEqual(approval["approved_payload_hash"], draft["draft_payload_hash"])
        attempt = self.attempt(graph, approval)
        self.assertEqual(self.row("approvals", approval["id"])["consumed_at_ms"], attempt["created_at_ms"])
        receipt = self.receipt(attempt)
        self.assertEqual(self.row("submission_attempts", attempt["id"])["state"], "received")
        self.assertEqual(self.row("test_receipts", receipt["id"])["status"], "accepted")

    def test_cross_workspace_task_context_is_rejected(self):
        first, second = self.workspace(), self.workspace()
        first["context_id"] = second["context_id"]
        with self.assertRaises(sqlite3.IntegrityError):
            self.task(first, "search")

    def test_cross_workspace_candidate_run_is_rejected(self):
        first, second = self.search_scope(), self.search_scope()
        first["search_run_id"] = second["search_run_id"]
        with self.assertRaises(sqlite3.IntegrityError):
            self.candidate(first)

    def test_eleventh_candidate_and_duplicate_job_are_rejected(self):
        scope = self.search_scope()
        candidates = [self.candidate(scope, slot) for slot in range(1, 11)]
        with self.assertRaises(sqlite3.IntegrityError):
            self.candidate(scope, 11)
        other = self.search_scope()
        one = self.candidate(other, 1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.candidate(other, 2, job_key=one["job_key"])
        self.assertEqual(len(candidates), 10)

    def test_analysis_selection_limit_is_explicitly_not_a_sql_guarantee(self):
        # This deliberate boundary test demonstrates why HTTP must reject four
        # selections. The DB protects task identity, not the nested input schema.
        scope = self.search_scope()
        ids = [self.candidate(scope, slot)["id"] for slot in range(1, 5)]
        task = self.task(scope, "analysis", {"candidate_ids": ids})
        self.assertEqual(len(json.loads(self.row("tasks", task["id"])["input_json"])["candidate_ids"]), 4)

    def test_research_target_cannot_change_after_reservation(self):
        graph = self.application()
        different = self.candidate(graph, 2, company_key="different-company")
        second_task = self.task(graph, "brief")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE search_runs SET selected_company_key=?, research_task_id=? WHERE id=?",
                            (different["company_key"], second_task["id"], graph["search_run_id"]))

    def test_assessment_cannot_use_another_candidates_facts(self):
        first = self.application()
        second = self.application(first, 2)
        values = self.row("assessments", first["assessment_id"])
        values.update({"id": self.ident("assessment"), "candidate_id": second["candidate_id"]})
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("assessments", values)

    def test_brief_cannot_mix_assessment_context(self):
        graph = self.application()
        new_context = self.context(graph["workspace_id"])
        values = self.row("brief_snapshots", graph["brief_id"])
        values.update({"id": self.ident("brief"), "context_revision_id": new_context["id"]})
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("brief_snapshots", values)

    def test_brief_rebuild_uses_new_context_and_same_candidates_existing_company_facts(self):
        graph = self.application()
        other_candidate = self.application(graph, 2)
        new_context = self.context(graph["workspace_id"])
        assessment = self.row("assessments", graph["assessment_id"])
        assessment.update({"id": self.ident("assessment"), "context_revision_id": new_context["id"]})
        self.insert("assessments", assessment)
        assembly = self.task({**graph, "context_id": new_context["id"]}, "brief",
                             {"reuse_company_fact_bundle_id": graph["company_facts_id"]})
        brief = self.row("brief_snapshots", graph["brief_id"])
        brief.update({"id": self.ident("brief"), "context_revision_id": new_context["id"],
                      "assessment_id": assessment["id"], "task_id": assembly["id"]})
        self.insert("brief_snapshots", brief)
        self.assertEqual(self.row("brief_snapshots", brief["id"])["company_fact_bundle_id"], graph["company_facts_id"])
        self.assertEqual(self.db.execute("SELECT count(*) FROM provider_calls").fetchone()[0], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("brief_snapshots", {**brief, "id": self.ident("brief"),
                        "company_fact_bundle_id": other_candidate["company_facts_id"]})

    def test_revision_cannot_reference_another_applications_candidate_or_brief(self):
        first = self.application()
        second = self.application(first, 2)
        with self.assertRaises(sqlite3.IntegrityError):
            self.append_revision(first, candidate_id=second["candidate_id"], brief_snapshot_id=second["brief_id"])

    def test_revision_cannot_attach_another_workspaces_file(self):
        first, second = self.application(), self.application()
        with self.assertRaises(sqlite3.IntegrityError):
            self.append_revision(first, file_id=second["file_id"])

    def test_approval_cannot_use_another_applications_form_session(self):
        first = self.application()
        second = self.application(first, 2)
        other_form = self.form_session(second)
        with self.assertRaises(sqlite3.IntegrityError):
            self.approval(first, other_form)

    def test_old_revision_approval_is_rejected_and_existing_approval_is_revoked(self):
        graph = self.application()
        old = self.approval(graph)
        self.append_revision(graph)
        self.assertIsNotNone(self.row("approvals", old["id"])["revoked_at_ms"])
        with self.assertRaises(sqlite3.IntegrityError):
            self.approval(graph, application_revision=1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.attempt(graph, old)

    def test_prepared_attempt_locks_draft_and_disallows_duplicate_attempt(self):
        graph = self.application()
        first, second = self.approval(graph), self.approval(graph)
        self.attempt(graph, first)
        self.assertIsNotNone(self.row("approvals", second["id"])["revoked_at_ms"])
        with self.assertRaises(sqlite3.IntegrityError):
            self.append_revision(graph)
        with self.assertRaises(sqlite3.IntegrityError):
            self.attempt(graph, first)
        with self.assertRaises(sqlite3.IntegrityError):
            self.attempt(graph, second)
        with self.assertRaises(sqlite3.IntegrityError):
            self.approval(graph)

    def test_received_application_is_permanently_locked(self):
        graph = self.application()
        attempt = self.attempt(graph, self.approval(graph))
        self.receipt(attempt)
        with self.assertRaises(sqlite3.IntegrityError):
            self.append_revision(graph)
        with self.assertRaises(sqlite3.IntegrityError):
            self.approval(graph)
        with self.assertRaises(sqlite3.IntegrityError):
            self.close_attempt(attempt)

    def test_duplicate_receipt_for_application_is_rejected(self):
        graph = self.application()
        attempt = self.attempt(graph, self.approval(graph))
        self.receipt(attempt)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "application already accepted"):
            self.receipt(attempt)

    def test_receipt_cannot_change_hash_application_or_workspace(self):
        first, second = self.application(), self.application()
        attempt = self.attempt(first, self.approval(first))
        for changes in ({"approved_payload_hash": digest("different")},
                        {"application_id": second["application_id"]},
                        {"workspace_id": second["workspace_id"]}):
            with self.subTest(changes=changes), self.assertRaises(sqlite3.IntegrityError):
                self.receipt(attempt, **changes)

    def test_closed_attempt_blocks_late_receipt_and_requires_new_review(self):
        graph = self.application()
        old_approval = self.approval(graph)
        old_attempt = self.attempt(graph, old_approval)
        # Runtime reconcile must perform the receipt lookup and this closure in
        # one write transaction. This tests the durable late-request exclusion.
        self.db.execute("BEGIN IMMEDIATE")
        self.assertIsNone(self.db.execute("SELECT id FROM test_receipts WHERE attempt_id=?",
                                         (old_attempt["id"],)).fetchone())
        self.close_attempt(old_attempt)
        self.db.execute("COMMIT")
        with self.assertRaises(sqlite3.IntegrityError):
            self.receipt(old_attempt)
        with self.assertRaises(sqlite3.IntegrityError):
            self.attempt(graph, old_approval)
        new_attempt = self.attempt(graph, self.approval(graph))
        self.receipt(new_attempt)
        self.assertEqual(self.row("submission_attempts", old_attempt["id"])["state"], "closed_not_accepted")

    def test_rejected_attempt_is_preserved_and_allows_new_revision(self):
        graph = self.application()
        attempt = self.attempt(graph, self.approval(graph))
        self.close_attempt(attempt, "rejected")
        self.append_revision(graph)
        self.assertEqual(graph["revision"], 2)
        self.assertEqual(self.row("submission_attempts", attempt["id"])["state"], "rejected")
        with self.assertRaises(sqlite3.IntegrityError):
            self.receipt(attempt)

    def test_received_cannot_be_marked_without_a_receipt(self):
        graph = self.application()
        attempt = self.attempt(graph, self.approval(graph))
        stamp = self.now()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE submission_attempts SET state='received', terminal_at_ms=?, updated_at_ms=? WHERE id=?",
                            (stamp, stamp, attempt["id"]))

    def test_receipt_at_expiry_is_rejected(self):
        graph = self.application()
        attempt = self.attempt(graph, self.approval(graph))
        with self.assertRaises(sqlite3.IntegrityError):
            self.receipt(attempt, accepted_at_ms=attempt["expires_at_ms"])

    def test_revoked_form_blocks_receipt(self):
        graph = self.application()
        form = self.form_session(graph)
        attempt = self.attempt(graph, self.approval(graph, form))
        self.db.execute("UPDATE form_sessions SET revoked_at_ms=? WHERE id=?", (self.now(), form["id"]))
        with self.assertRaises(sqlite3.IntegrityError):
            self.receipt(attempt)

    def test_snapshots_and_receipts_reject_update_and_delete(self):
        graph = self.application()
        attempt = self.attempt(graph, self.approval(graph))
        receipt = self.receipt(attempt)
        records = (
            ("context_revisions", graph["context_id"]), ("job_candidates", graph["candidate_id"]),
            ("fact_bundles", graph["job_facts_id"]), ("assessments", graph["assessment_id"]),
            ("brief_snapshots", graph["brief_id"]), ("files", graph["file_id"]),
            ("application_revisions", graph["revision_id"]), ("test_receipts", receipt["id"]),
        )
        for table, identifier in records:
            with self.subTest(table=table, operation="update"), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"UPDATE {table} SET id=id WHERE id=?", (identifier,))
            with self.subTest(table=table, operation="delete"), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"DELETE FROM {table} WHERE id=?", (identifier,))

    def test_approval_content_cannot_change_or_consumption_be_fabricated(self):
        graph = self.application()
        approval = self.approval(graph)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE approvals SET approved_payload_hash=? WHERE id=?",
                            (digest("changed"), approval["id"]))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE approvals SET consumed_at_ms=? WHERE id=?", (self.now(), approval["id"]))
        self.db.execute("UPDATE approvals SET revoked_at_ms=? WHERE id=?", (self.now(), approval["id"]))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE approvals SET revoked_at_ms=NULL WHERE id=?", (approval["id"],))

    def test_form_binding_and_application_identity_cannot_change(self):
        graph = self.application()
        form = self.form_session(graph)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE form_sessions SET exact_origin='https://other.example' WHERE id=?", (form["id"],))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE applications SET job_key='other-job' WHERE id=?", (graph["application_id"],))
        stamp = self.now()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("applications", {"id": self.ident("application"), "workspace_id": graph["workspace_id"],
                "candidate_id": graph["candidate_id"], "job_key": graph["job_key"], "target_id": TARGET,
                "created_at_ms": stamp, "updated_at_ms": stamp})

    def test_request_key_uniqueness_does_not_implement_request_replay(self):
        scope = self.workspace()
        stamp = self.now()
        # These fixtures use only simple string/array values, for which encode
        # matches JCS. This helper is not a general JCS implementation.
        body = {"candidate_ids": ["candidate-a"]}
        original_hash = digest("POST\n/api/search-runs/run-a/analyses\n" + encode(body))
        different_body_hash = digest("POST\n/api/search-runs/run-a/analyses\n" +
                                     encode({"candidate_ids": ["candidate-b"]}))
        different_target_hash = digest("POST\n/api/search-runs/run-b/analyses\n" + encode(body))
        values = {"workspace_id": scope["workspace_id"], "operation": "analysis.create",
                  "idempotency_key": "one-key", "request_hash": original_hash,
                  "created_at_ms": stamp, "updated_at_ms": stamp}
        self.insert("request_keys", values)
        # All duplicate inserts fail. The API must read the existing row and
        # distinguish exact replay from changed body/actual target path (409).
        for request_hash in (original_hash, different_body_hash, different_target_hash):
            with self.subTest(request_hash=request_hash), self.assertRaises(sqlite3.IntegrityError):
                self.insert("request_keys", {**values, "request_hash": request_hash})
        self.insert("request_keys", {**values, "operation": "brief.create"})
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE request_keys SET request_hash=? WHERE operation='analysis.create'",
                            (different_target_hash,))

    def test_task_state_lease_checks_and_immutable_inputs(self):
        scope = self.workspace()
        task = self.task(scope, "search")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tasks SET state='running' WHERE id=?", (task["id"],))
        self.db.execute("UPDATE tasks SET state='running', lease_generation=1, lease_owner='worker-a', lease_until_ms=? WHERE id=?",
                        (self.now() + 10_000, task["id"]))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tasks SET input_json='{}' WHERE id=?", (task["id"],))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tasks SET lease_generation=0 WHERE id=?", (task["id"],))
        # Worker completion must additionally use an expected generation/owner
        # WHERE predicate; this file does not implement worker fencing behavior.

    def test_provider_call_must_belong_to_its_workspace_task(self):
        first, second = self.workspace(), self.workspace()
        task = self.task(second, "search")
        stamp = self.now()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("provider_calls", {"id": self.ident("call"), "workspace_id": first["workspace_id"],
                "task_id": task["id"], "call_number": 1, "lease_generation": 1,
                "endpoint": "/api/v1/tools/search/web", "request_json": "{}", "request_hash": digest({}),
                "created_at_ms": stamp, "updated_at_ms": stamp})

    def test_invalid_json_and_nonsynthetic_file_are_rejected(self):
        scope = self.workspace()
        task = self.task(scope, "search")
        values = self.row("tasks", task["id"])
        values.update({"id": self.ident("task"), "input_json": "not-json"})
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("tasks", values)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("files", {"id": self.ident("file"), "workspace_id": scope["workspace_id"],
                "is_synthetic": 0, "original_filename": "real.pdf", "mime_type": "application/pdf",
                "byte_size": 10, "sha256": digest("bytes"), "object_key": "not-allowed",
                "created_at_ms": self.now()})


if __name__ == "__main__":
    unittest.main()
