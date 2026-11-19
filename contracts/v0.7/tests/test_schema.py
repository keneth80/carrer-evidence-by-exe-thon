"""Public shapes and API references only; this does not execute product handlers."""
import copy
import json
import re
import unittest
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator, FormatChecker, ValidationError

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / 'schemas/domain.schema.json').read_text())
DEFS = SCHEMA['$defs']

def validate(name, value):
    Draft202012Validator({'$ref': '#/$defs/' + name, '$defs': DEFS}, format_checker=FormatChecker()).validate(value)

def example(name):
    return json.loads((ROOT / 'examples' / (name + '.json')).read_text())

class SchemaTests(unittest.TestCase):
    def test_schema_and_synthetic_examples(self):
        Draft202012Validator.check_schema(SCHEMA)
        for entry in json.loads((ROOT / 'examples/manifest.json').read_text()):
            with self.subTest(file=entry['file']):
                validate(entry['definition'], json.loads((ROOT / 'examples' / entry['file']).read_text()))

    def test_policy_grant_cannot_claim_user_review(self):
        value=example('policy_authorization'); value['user_reviewed_at']=value['created_at']
        with self.assertRaises(ValidationError):validate('ApplicationAuthorization',value)

    def test_manual_grant_cannot_carry_policy_authority(self):
        value=example('manual_authorization'); value['policy_revision_id']='policy_1'
        with self.assertRaises(ValidationError):validate('ApplicationAuthorization',value)

    def test_fixed_document_cannot_enable_edits(self):
        value=example('policy'); value['allowed_edits']=['rewrite_with_facts']
        with self.assertRaises(ValidationError):validate('AutoApplyPolicyRevision',value)

    def test_tailor_mode_cannot_smuggle_fixed_file(self):
        value=example('policy'); value['document_strategy']='tailor_within_facts'
        with self.assertRaises(ValidationError):validate('AutoApplyPolicyRevision',value)

    def test_final_resume_requires_finalization(self):
        value=example('resume');value['finalized_at']=None
        with self.assertRaises(ValidationError):validate('ResumeRevision',value)

    def test_search_query_requires_fact_evidence(self):
        value=example('search_intent');value['queries'][0]['fact_ids']=[]
        with self.assertRaises(ValidationError):validate('SearchIntent',value)

    def test_request_cannot_choose_workspace(self):
        value={'text':'synthetic resume','workspace_id':'someone_else'}
        with self.assertRaises(ValidationError):validate('PastedTextCreate',value)

    def test_required_salary_requires_numeric_value_currency(self):
        value={'field':'annual_salary','operator':'gte','values':['negotiable'],'importance':'required','currency':None}
        with self.assertRaises(ValidationError):validate('Condition',value)

    def test_recruiting_rejection_is_not_a_submission_state(self):
        value=example('application');value['submission_state']='rejected'
        with self.assertRaises(ValidationError):validate('Application',value)
        value=example('application');value['recruitment_stage']='rejected';validate('Application',value)

    def test_api_references_and_operations(self):
        """Structural closure; not a full OpenAPI conformance validator."""
        api=yaml.safe_load((ROOT/'openapi.yaml').read_text()); ids=set(); count=0
        def check_refs(value):
            if isinstance(value,dict):
                if '$ref' in value:
                    reference=value['$ref']
                    self.assertTrue(reference.startswith('./schemas/domain.schema.json#/$defs/'))
                    self.assertIn(reference.rsplit('/',1)[-1],DEFS)
                for item in value.values():check_refs(item)
            elif isinstance(value,list):
                for item in value:check_refs(item)
        check_refs(api)
        for path, methods in api['paths'].items():
            self.assertTrue(path.startswith('/api/v1/'))
            for method, operation in methods.items():
                count+=1;self.assertNotIn(operation['operationId'],ids);ids.add(operation['operationId'])
                declared={p['name'] for p in operation['parameters'] if p['in']=='path'}
                self.assertEqual(declared,set(re.findall(r'{([^}]+)}',path)))
                self.assertTrue(any(k.startswith('2') for k in operation['responses']))
                if method!='get':
                    self.assertIn('Idempotency-Key',[p['name'] for p in operation['parameters']])
                    self.assertTrue(operation['requestBody']['required'])
        self.assertGreaterEqual(count,40)

if __name__=='__main__':unittest.main()
