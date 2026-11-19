"""Contract/fixture validation only. No API, network, browser or provider execution."""
from pathlib import Path
import copy
import hashlib
import json
import re
import unittest
import yaml
from jsonschema import Draft202012Validator, FormatChecker, ValidationError
from referencing import Registry, Resource

ROOT=Path(__file__).resolve().parents[1]
DOMAIN=json.loads((ROOT/'schemas/domain.schema.json').read_text())
BASE=DOMAIN['$id']
REGISTRY=Registry().with_resource(BASE,Resource.from_contents(DOMAIN))
API=yaml.safe_load((ROOT/'openapi.yaml').read_text())

def fixture(name):return json.loads((ROOT/'examples'/f'{name}.json').read_text())
def validate(name,value):
    Draft202012Validator({'$ref':BASE+'#/$defs/'+name},registry=REGISTRY,format_checker=FormatChecker()).validate(value)

class ContractTests(unittest.TestCase):
    def rejects(self,name,value):
        with self.assertRaises(ValidationError):validate(name,value)

    def test_all_schemas_are_valid_2020_12(self):
        Draft202012Validator.check_schema(DOMAIN)
        for name,value in DOMAIN['$defs'].items():
            with self.subTest(schema=name):Draft202012Validator.check_schema(value)

    def test_all_declared_examples(self):
        manifest=fixture('manifest')
        self.assertEqual(len(manifest),19)
        for entry in manifest:
            with self.subTest(example=entry['file']):
                validate(entry['schema'],json.loads((ROOT/'examples'/entry['file']).read_text()))

    def test_analysis_rejects_four_candidates(self):
        v=fixture('analysis_request');v['candidate_ids']=[f'candidate_demo_00{i}' for i in range(1,5)]
        self.rejects('AnalysisCreate',v)

    def test_analysis_rejects_duplicate_candidates(self):
        v=fixture('analysis_request');v['candidate_ids']*=2
        self.rejects('AnalysisCreate',v)

    def test_unknown_claim_does_not_mean_false(self):
        v=fixture('facts')['claims'][0];v.update(state='unknown',value=False,reason='not_found_in_retrieved_material',evidence=[])
        self.rejects('Claim',v)

    def test_known_claim_requires_evidence(self):
        v=fixture('facts')['claims'][0];v['evidence']=[]
        self.rejects('Claim',v)

    def test_gap_cannot_mean_missing_profile_or_source(self):
        for reason in ['PROFILE_MISSING','SOURCE_MISSING']:
            v=fixture('assessment')['evaluations'][0];v.update(state='gap',reason_code=reason)
            with self.subTest(reason=reason):self.rejects('ConditionEvaluation',v)

    def test_conflicting_claim_requires_both_evidence_entries(self):
        v=fixture('facts')['claims'][0];v.update(state='conflicting',value=None,reason='sources_conflict')
        self.rejects('Claim',v)

    def test_approval_requires_consent(self):
        v=fixture('approval_request');v['readback']['consent']['test_submission']=False
        self.rejects('ApprovalCreate',v)

    def test_approval_requires_nonblank_answer(self):
        v=fixture('approval_request');v['readback']['answers'][0]['value']=' \n '
        self.rejects('ApprovalCreate',v)

    def test_approval_requires_each_question_once(self):
        v=fixture('approval_request');v['readback']['answers'][1]['question_id']='experience'
        self.rejects('ApprovalCreate',v)

    def test_answer_limit_and_extra_data(self):
        v=fixture('approved_payload');v['answers'][0]['value']='가'*501
        self.rejects('ApprovedPayload',v)
        v=fixture('approved_payload');v['server_api_key']='must-not-appear'
        self.rejects('ApprovedPayload',v)

    def test_submission_success_cannot_be_prepared(self):
        self.rejects('ReceivedAttempt',fixture('attempt_prepared'))

    def test_reconcile_cannot_leave_prepared(self):
        self.rejects('ResolvedAttempt',fixture('attempt_prepared'))

    def test_received_requires_receipt(self):
        v=fixture('attempt_received');v['receipt']=None
        self.rejects('Attempt',v)

    def test_prepared_is_not_closed_or_rejected(self):
        v=fixture('attempt_prepared');v['closed_at']='2026-11-15T11:01:00Z';v['rejection_code']='ERROR'
        self.rejects('Attempt',v)

    def test_received_application_must_lock(self):
        v=fixture('application');v['receipt_id']='receipt_demo_001'
        self.rejects('Application',v)

    def test_task_success_requires_finished_outcome(self):
        v=fixture('task_partial');v['phase']='queued';v['outcome']=None
        self.rejects('Task',v)

    def test_fixture_task_progress_is_consistent(self):
        v=fixture('task_partial');p=v['progress']
        # Cross-field arithmetic remains a service invariant; standard schema
        # bounds alone do not implement it.
        self.assertEqual(p['total'],len(v['items']))
        self.assertLessEqual(p['settled'],p['total'])
        self.assertLessEqual(p['succeeded']+p['failed'],p['settled'])

    def test_extension_disallows_arbitrary_url_operation(self):
        v=fixture('extension_prepare');v['op']='FETCH_URL';v['payload']={'url':'https://example.com'}
        self.rejects('ExtensionMessage',v)

    def test_extension_submit_success_requires_received(self):
        v=fixture('extension_received');v['data']=fixture('attempt_prepared')
        self.rejects('ExtensionMessage',v)

    def test_extension_disallows_secret_in_success(self):
        v=fixture('extension_received');v['data']['csrf_token']='not-allowed'
        self.rejects('ExtensionMessage',v)

    def test_digest_and_pdf_fixture_match(self):
        hashes=fixture('hashes');raw=(ROOT/'examples/approved_payload.canonical.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),hashes['canonical_payload_sha256'])
        self.assertEqual(json.loads(raw),fixture('approved_payload'))
        file=fixture('files')['files'][0];pdf=(ROOT/'fixtures/synthetic_resume.pdf').read_bytes()
        self.assertEqual(len(pdf),file['byte_size'])
        self.assertEqual(hashlib.sha256(pdf).hexdigest(),file['sha256'])
        self.assertEqual(file['sha256'],fixture('approved_payload')['file']['sha256'])
        self.assertEqual(fixture('approval')['payload_digest'],hashes['canonical_payload_sha256'])

    def test_request_fingerprint_binds_target_path(self):
        def fp(path):return hashlib.sha256(('POST\n'+path+'\n{}').encode()).hexdigest()
        self.assertNotEqual(fp('/api/v1/tasks/task_demo_001/cancel'),fp('/api/v1/tasks/task_demo_002/cancel'))

    def test_openapi_refs_resolve_locally(self):
        docs={ROOT/'openapi.yaml':API, ROOT/'schemas/domain.schema.json':DOMAIN}
        def resolve(path,reference):
            location,_,fragment=reference.partition('#')
            target=(path.parent/location).resolve() if location else path
            self.assertIn(target,docs,reference)
            node=docs[target]
            for part in fragment.strip('/').split('/') if fragment else []:
                node=node[part.replace('~1','/').replace('~0','~')]
        def walk(value,path):
            if isinstance(value,dict):
                if '$ref' in value:resolve(path,value['$ref'])
                for child in value.values():walk(child,path)
            elif isinstance(value,list):
                for child in value:walk(child,path)
        for path,doc in docs.items():walk(doc,path)

    def test_openapi_operations_paths_and_security(self):
        ids=[]
        for path,item in API['paths'].items():
            for method,operation in item.items():
                ids.append(operation['operationId'])
                declared={p['name'] for p in operation.get('parameters',[]) if p['in']=='path' and p['required']}
                self.assertEqual(set(re.findall(r'\{(\w+)\}',path)),declared)
                if path=='/api/v1/demo/session':continue
                self.assertIn('sessionCookie',operation['security'][0])
                if method!='get':self.assertIn('csrfHeader',operation['security'][0])
        self.assertEqual(len(ids),29);self.assertEqual(len(ids),len(set(ids)))

    def test_openapi_success_types_are_narrowed(self):
        submit=API['paths']['/demo/v1/submissions']['post']
        for status in ['200','201']:
            self.assertTrue(submit['responses'][status]['content']['application/json']['schema']['$ref'].endswith('/ReceivedAttempt'))
        reconcile=API['paths']['/api/v1/attempts/{attempt_id}/reconcile']['post']
        self.assertTrue(reconcile['responses']['200']['content']['application/json']['schema']['$ref'].endswith('/ResolvedAttempt'))

if __name__=='__main__':unittest.main(verbosity=2)
