"""Meaningful DB invariants on an isolated in-memory baseline + candidate migration.
No product handler, browser, external ATS, model or deployment is exercised.
"""
import hashlib
import sqlite3
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASELINE=ROOT.parent/'v0.4/schema.sql'
MIGRATION=ROOT/'migrations/007_resume_workflow.sql'
H='a'*64

class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:',isolation_level=None)
        self.db.executescript(BASELINE.read_text())
        self.baseline_objects=dict(self.db.execute("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"))
        self.db.executescript('BEGIN IMMEDIATE;\n'+MIGRATION.read_text()+'\nCOMMIT;')
        self.workspace('w1');self.workspace('w2')
        self.fixture()

    def tearDown(self):self.db.close()

    def insert(self,table,**values):
        self.db.execute('INSERT INTO '+table+'('+','.join(values)+') VALUES('+','.join('?' for _ in values)+')',list(values.values()))

    def workspace(self,name,mode='synthetic_local'):
        token=hashlib.sha256(name.encode()).hexdigest()
        self.insert('workspaces',id=name,session_token_hash=token,csrf_token_hash=H,revision=0,current_context_id=None,created_at_ms=0,expires_at_ms=999999,updated_at_ms=0)
        self.insert('ce7_principals',id='p_'+name,auth_subject='test:'+name,mode=mode,created_at_ms=0)
        self.insert('ce7_workspace_owners',workspace_id=name,principal_id='p_'+name,created_at_ms=0)

    def fixture(self):
        self.insert('ce7_documents',id='d1',workspace_id='w1',input_kind='text_pdf',filename='synthetic.pdf',mime_type='application/pdf',byte_size=100,sha256=H,object_key='original/d1',data_origin='synthetic',extraction_status='extracted',created_at_ms=0)
        self.insert('ce7_fact_revisions',id='f1',workspace_id='w1',document_id='d1',revision=1,facts_json='[]',content_hash=H,confirmed_at_ms=1,created_at_ms=1)
        self.db.execute("UPDATE ce7_documents SET current_fact_revision_id='f1' WHERE id='d1'")
        self.job('j1','demo:1')
        self.insert('ce7_tailoring_sessions',id='s1',workspace_id='w1',job_snapshot_id='j1',fact_revision_id='f1',state='editing',created_at_ms=1)
        self.insert('ce7_resume_revisions',id='r1',workspace_id='w1',session_id='s1',job_snapshot_id='j1',fact_revision_id='f1',revision=1,blocks_json='[]',content_hash=H,state='final',finalized_at_ms=2,finalization_source='user',created_at_ms=1)
        self.insert('ce7_artifacts',id='a1',workspace_id='w1',resume_revision_id='r1',filename='synthetic.pdf',mime_type='application/pdf',byte_size=100,sha256=H,object_key='rendered/a1',created_at_ms=3)
        self.insert('ce7_account_bindings',id='b1',workspace_id='w1',site_id='demo',executor='chrome',account_label='synthetic account',account_fingerprint=H,verified_at_ms=1)
        self.application('app1','j1','demo:1')

    def job(self,jid,key):
        self.insert('ce7_job_snapshots',id=jid,workspace_id='w1',job_key=key,company_name='Synthetic Co',title='Developer',canonical_url='https://example.invalid/'+jid,site_id='demo',content_text='synthetic',requirements_json='[]',content_hash=H,open_status='open',data_origin='synthetic',observed_at_ms=0)

    def application(self,aid,jid,key):
        self.insert('ce7_applications',id=aid,workspace_id='w1',job_key=key,current_revision=None,source_kind='manual',created_at_ms=3,updated_at_ms=3)
        self.insert('ce7_application_revisions',workspace_id='w1',application_id=aid,revision=1,job_snapshot_id=jid,resume_revision_id='r1',artifact_id='a1',artifact_sha256=H,answers_json='[]',payload_hash=H,created_at_ms=3)
        self.db.execute('UPDATE ce7_applications SET current_revision=1 WHERE id=?',(aid,))

    def second_application(self):self.job('j2','demo:2');self.application('app2','j2','demo:2')

    def policy(self,daily=1,total=2):
        self.insert('ce7_policy_controls',workspace_id='w1',policy_id='policy1',state='draft',generation=1,updated_at_ms=0)
        self.insert('ce7_policy_revisions',id='pr1',workspace_id='w1',policy_id='policy1',revision=1,mode='submit',document_strategy='fixed_document',fact_revision_id='f1',seed_resume_revision_id='r1',fixed_artifact_id='a1',conditions_json='[]',allowed_sites_json='["demo"]',account_bindings_json='["b1"]',excluded_companies_json='[]',allowed_edits_json='[]',daily_limit=daily,total_limit=total,budget_limit_micro_usd=0,quota_timezone='Asia/Seoul',valid_from_ms=0,expires_at_ms=10000,content_hash=H,created_at_ms=0)
        self.db.execute("UPDATE ce7_policy_controls SET active_revision_id='pr1',state='active',generation=2 WHERE policy_id='policy1'")
        self.insert('ce7_campaigns',id='c1',workspace_id='w1',policy_revision_id='pr1',seed_application_id='app1',seed_application_revision=1,seed_job_snapshot_id='j1',seed_resume_revision_id='r1',state='active',created_at_ms=1)

    def authorization(self,gid='g1',aid='app1',jid='j1',kind='manual',**override):
        values=dict(id=gid,workspace_id='w1',application_id=aid,application_revision=1,kind=kind,job_snapshot_id=jid,resume_revision_id='r1',artifact_id='a1',artifact_sha256=H,payload_hash=H,executor='chrome',site_id='demo',adapter_version='demo.v1',account_binding_id='b1',target_url='http://127.0.0.1:4310/demo/apply',form_snapshot_hash=H,created_at_ms=10,expires_at_ms=9999)
        if kind=='manual':values['user_reviewed_at_ms']=10
        else:values.update(policy_revision_id='pr1',policy_generation=2,campaign_id='c1',policy_evaluation_hash=H)
        values.update(override);self.insert('ce7_authorizations',**values)

    def attempt(self,tid='t1',gid='g1',aid='app1',executor='chrome'):
        self.insert('ce7_attempts',id=tid,workspace_id='w1',application_id=aid,authorization_id=gid,executor=executor,state='prepared',created_at_ms=20,updated_at_ms=20)

    def dispatch(self,tid='t1'):
        self.db.execute("UPDATE ce7_attempts SET state='dispatched',dispatch_started_at_ms=30,updated_at_ms=30 WHERE id=?",(tid,))

    def unknown(self,tid='t1'):
        self.db.execute("UPDATE ce7_attempts SET state='submission_unknown',updated_at_ms=31 WHERE id=?",(tid,))

    def reserve(self,qid='q1',tid='t1',date='2026-11-16'):
        self.insert('ce7_quota_reservations',id=qid,workspace_id='w1',policy_id='policy1',policy_revision_id='pr1',attempt_id=tid,business_date=date,state='reserved',cost_reserved_micro_usd=0,created_at_ms=25)

    def evidence(self,kind='receipt_id',conclusion='submitted'):
        self.insert('ce7_submission_evidence',id='e1',workspace_id='w1',attempt_id='t1',kind=kind,conclusion=conclusion,summary='synthetic evidence',evidence_hash=H,observed_at_ms=40)

    def test_additive_migration_preserves_baseline_objects(self):
        current=dict(self.db.execute("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"))
        self.assertTrue(all(current[k]==v for k,v in self.baseline_objects.items()))
        self.assertEqual(self.db.execute('PRAGMA foreign_keys').fetchone()[0],1)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_synthetic_session_cannot_store_real_resume(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,'AUTHENTICATED_OWNER_REQUIRED'):
            self.insert('ce7_documents',id='real',workspace_id='w1',input_kind='pasted_text',filename='resume.txt',mime_type='text/plain',byte_size=20,sha256=H,object_key='real',data_origin='user',extraction_status='uploaded',created_at_ms=0)

    def test_document_mime_and_original_bytes_are_fixed(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,'IMMUTABLE_PAYLOAD'):
            self.db.execute("UPDATE ce7_documents SET sha256=? WHERE id='d1'",('b'*64,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('ce7_documents',id='bad',workspace_id='w1',input_kind='text_pdf',filename='bad',mime_type='text/plain',byte_size=1,sha256=H,object_key='bad',data_origin='synthetic',extraction_status='uploaded',created_at_ms=0)

    def test_cross_workspace_fact_reference_is_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('ce7_search_intents',id='cross',workspace_id='w2',fact_revision_id='f1',conditions_json='[]',queries_json='[]',content_hash=H,created_at_ms=1)

    def test_confirmed_fact_revision_is_immutable(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,'IMMUTABLE_RECORD'):
            self.db.execute("UPDATE ce7_fact_revisions SET facts_json='[{}]' WHERE id='f1'")

    def test_artifact_requires_final_resume(self):
        self.insert('ce7_resume_revisions',id='draft',workspace_id='w1',session_id='s1',job_snapshot_id='j1',fact_revision_id='f1',revision=2,parent_revision_id='r1',blocks_json='[]',content_hash=H,state='draft',created_at_ms=4)
        with self.assertRaisesRegex(sqlite3.IntegrityError,'RESUME_NOT_FINAL'):
            self.insert('ce7_artifacts',id='draft_file',workspace_id='w1',resume_revision_id='draft',filename='draft.pdf',mime_type='application/pdf',byte_size=1,sha256=H,object_key='draft_file',created_at_ms=4)

    def test_application_cannot_substitute_file_hash(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('ce7_application_revisions',workspace_id='w1',application_id='app1',revision=2,job_snapshot_id='j1',resume_revision_id='r1',artifact_id='a1',artifact_sha256='b'*64,answers_json='[]',payload_hash=H,created_at_ms=4)

    def test_duplicate_job_identity_is_shared_across_channels(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('ce7_applications',id='duplicate',workspace_id='w1',job_key='demo:1',source_kind='manual',created_at_ms=1,updated_at_ms=1)

    def test_manual_and_policy_authority_are_exclusive(self):
        self.policy()
        with self.assertRaises(sqlite3.IntegrityError):
            self.authorization(kind='policy',user_reviewed_at_ms=10)

    def test_authorization_cannot_be_used_for_other_job(self):
        self.second_application();self.authorization()
        with self.assertRaises(sqlite3.IntegrityError):self.attempt(aid='app2')

    def test_authorization_is_single_use_after_pre_dispatch_failure(self):
        self.authorization();self.attempt()
        self.db.execute("UPDATE ce7_attempts SET state='failed_before_dispatch' WHERE id='t1'")
        with self.assertRaises(sqlite3.IntegrityError):self.attempt(tid='t2')

    def test_unknown_attempt_blocks_new_authorization_effect(self):
        self.authorization();self.attempt();self.dispatch();self.unknown()
        self.authorization(gid='g2')
        with self.assertRaises(sqlite3.IntegrityError):self.attempt(tid='t2',gid='g2')

    def test_unknown_is_not_proof_of_non_submission(self):
        self.authorization();self.attempt();self.dispatch();self.unknown()
        with self.assertRaisesRegex(sqlite3.IntegrityError,'NO_DELIVERY_PROOF_REQUIRED'):
            self.db.execute("UPDATE ce7_attempts SET state='not_submitted' WHERE id='t1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'INVALID_ATTEMPT_TRANSITION|DISPATCH_TIME_IMMUTABLE'):
            self.db.execute("UPDATE ce7_attempts SET state='failed_before_dispatch',dispatch_started_at_ms=NULL WHERE id='t1'")

    def test_click_alone_does_not_mark_submitted(self):
        self.authorization();self.attempt();self.dispatch()
        with self.assertRaisesRegex(sqlite3.IntegrityError,'SUBMISSION_EVIDENCE_REQUIRED'):
            self.db.execute("UPDATE ce7_attempts SET state='submitted' WHERE id='t1'")

    def test_evidence_resolves_unknown_and_terminal_is_frozen(self):
        self.authorization();self.attempt();self.dispatch();self.unknown();self.evidence()
        self.db.execute("UPDATE ce7_attempts SET state='submitted' WHERE id='t1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'TERMINAL_ATTEMPT_IMMUTABLE'):
            self.db.execute("UPDATE ce7_attempts SET state='not_submitted' WHERE id='t1'")

    def test_no_delivery_proof_can_resolve_unknown(self):
        self.authorization();self.attempt();self.dispatch();self.unknown();self.evidence('no_delivery_proof','not_submitted')
        self.db.execute("UPDATE ce7_attempts SET state='not_submitted' WHERE id='t1'")
        self.authorization(gid='g2');self.attempt(tid='t2',gid='g2')

    def test_policy_requires_active_generation(self):
        self.policy();self.authorization(kind='policy')
        self.db.execute("UPDATE ce7_policy_controls SET state='paused',generation=3 WHERE policy_id='policy1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'POLICY_NOT_ACTIVE'):self.attempt()

    def test_policy_rechecked_after_prepare_before_dispatch(self):
        self.policy();self.authorization(kind='policy');self.attempt();self.reserve()
        self.db.execute("UPDATE ce7_policy_controls SET state='paused',generation=3 WHERE policy_id='policy1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'POLICY_OR_QUOTA_NOT_READY'):self.dispatch()

    def test_policy_cannot_dispatch_without_quota(self):
        self.policy();self.authorization(kind='policy');self.attempt()
        with self.assertRaisesRegex(sqlite3.IntegrityError,'POLICY_OR_QUOTA_NOT_READY'):self.dispatch()

    def test_daily_quota_counts_pending_reservations(self):
        self.policy();self.authorization(kind='policy');self.attempt();self.reserve();self.second_application()
        self.authorization(gid='g2',aid='app2',jid='j2',kind='policy');self.attempt(tid='t2',gid='g2',aid='app2')
        with self.assertRaisesRegex(sqlite3.IntegrityError,'DAILY_LIMIT'):self.reserve('q2','t2')

    def test_unknown_does_not_refund_quota(self):
        self.policy();self.authorization(kind='policy');self.attempt();self.reserve();self.dispatch();self.unknown()
        with self.assertRaisesRegex(sqlite3.IntegrityError,'QUOTA_RELEASE_NOT_PROVEN'):
            self.db.execute("UPDATE ce7_quota_reservations SET state='released' WHERE id='q1'")

    def test_pre_dispatch_failure_allows_quota_release(self):
        self.policy();self.authorization(kind='policy');self.attempt();self.reserve()
        self.db.execute("UPDATE ce7_attempts SET state='failed_before_dispatch' WHERE id='t1'")
        self.db.execute("UPDATE ce7_quota_reservations SET state='released' WHERE id='q1'")
        self.assertEqual(self.db.execute("SELECT state FROM ce7_quota_reservations WHERE id='q1'").fetchone()[0],'released')

    def test_campaign_seed_cannot_expand_itself(self):
        self.policy()
        with self.assertRaisesRegex(sqlite3.IntegrityError,'IMMUTABLE_PAYLOAD'):
            self.db.execute("UPDATE ce7_campaigns SET seed_job_snapshot_id='j2' WHERE id='c1'")

    def test_policy_generation_must_advance(self):
        self.policy()
        with self.assertRaisesRegex(sqlite3.IntegrityError,'POLICY_GENERATION_MUST_ADVANCE'):
            self.db.execute("UPDATE ce7_policy_controls SET state='paused' WHERE policy_id='policy1'")

    def test_original_submitted_payload_survives_other_edits(self):
        self.authorization();self.attempt();self.dispatch();self.evidence();self.db.execute("UPDATE ce7_attempts SET state='submitted' WHERE id='t1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'IMMUTABLE_RECORD'):
            self.db.execute("UPDATE ce7_application_revisions SET answers_json='[{}]' WHERE application_id='app1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'ACTIVE_OR_SUBMITTED_APPLICATION'):
            self.db.execute("UPDATE ce7_applications SET current_revision=NULL WHERE id='app1'")

    def test_unknown_application_job_key_cannot_be_renamed_to_bypass_dedup(self):
        self.authorization();self.attempt();self.dispatch();self.unknown()
        with self.assertRaisesRegex(sqlite3.IntegrityError,'APPLICATION_IDENTITY_IMMUTABLE'):
            self.db.execute("UPDATE ce7_applications SET job_key='renamed:old' WHERE id='app1'")
        self.assertEqual(self.db.execute("SELECT job_key FROM ce7_applications WHERE id='app1'").fetchone()[0],'demo:1')
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('ce7_applications',id='app_duplicate',workspace_id='w1',job_key='demo:1',source_kind='manual',created_at_ms=50,updated_at_ms=50)

    def test_fixed_document_can_be_reused_for_new_job_with_new_policy_grant(self):
        self.policy();self.second_application()
        self.authorization(gid='grant_job2',aid='app2',jid='j2',kind='policy')
        self.attempt(tid='attempt_job2',gid='grant_job2',aid='app2');self.reserve('quota_job2','attempt_job2');self.dispatch('attempt_job2')
        self.assertEqual(self.db.execute("SELECT job_snapshot_id,resume_revision_id,artifact_id FROM ce7_authorizations WHERE id='grant_job2'").fetchone(),('j2','r1','a1'))
        self.assertEqual(self.db.execute("SELECT state FROM ce7_attempts WHERE id='attempt_job2'").fetchone()[0],'dispatched')

if __name__=='__main__':unittest.main()
