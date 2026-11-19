import { canonicalJson, fillValue, sha256 } from './payload.ts';
import { FILE_FIELD } from './self-form.ts';
import type { Answer, FormQuestion, FormSnapshot, Issue, QuestionKind, Readback } from './types.ts';

// 확장이 보고한 폼 구조(snapshot)와 입력 뒤 다시 읽은 값(readback)을 서버가 검증한다.
// 페이지 내용은 데이터일 뿐이다. 관측값이 기대와 다르면 권한을 만들지 않고 사용자 확인으로 넘긴다.

const KINDS: QuestionKind[] = ['text', 'email', 'textarea', 'checkbox'];
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join() === [...keys].sort().join();
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;

function parseQuestion(value: unknown): FormQuestion | null {
  if (!isObject(value) || !keysAre(value, ['question_id', 'label', 'kind', 'required', 'max_length'])) return null;
  const { question_id: id, label, kind, required, max_length: max } = value;
  if (typeof id !== 'string' || !ID.test(id) || !text(label, 200) || !KINDS.includes(kind as QuestionKind) || typeof required !== 'boolean') return null;
  if (!Number.isInteger(max) || (max as number) < 0 || (max as number) > 100_000) return null;
  return { question_id: id, label: label as string, kind: kind as QuestionKind, required, max_length: max as number };
}

export function parseSnapshot(value: unknown): FormSnapshot | null {
  if (!isObject(value) || !keysAre(value, ['site_id', 'adapter_version', 'posting', 'questions', 'file'])) return null;
  const { site_id: site, adapter_version: adapter, posting, questions, file } = value;
  if (!text(site, 64) || !text(adapter, 64) || !isObject(posting) || !keysAre(posting, ['posting_id', 'company_name', 'title'])) return null;
  if (!text(posting.posting_id, 128) || !text(posting.company_name, 200) || !text(posting.title, 200)) return null;
  if (!Array.isArray(questions) || questions.length > 50) return null;
  const parsed = questions.map(parseQuestion);
  if (parsed.some(item => item === null)) return null;
  let fileSpec: FormSnapshot['file'] = null;
  if (file !== null) {
    if (!isObject(file) || !keysAre(file, ['field', 'accept', 'required']) || !text(file.field, 64) || !text(file.accept, 200) || typeof file.required !== 'boolean') return null;
    fileSpec = { field: file.field as string, accept: file.accept as string, required: file.required };
  }
  return {
    site_id: site as string, adapter_version: adapter as string,
    posting: { posting_id: posting.posting_id as string, company_name: posting.company_name as string, title: posting.title as string },
    questions: parsed as FormQuestion[], file: fileSpec,
  };
}

export const snapshotHash = (snapshot: FormSnapshot) => sha256(canonicalJson(snapshot));

export type SnapshotExpectation = { site_id: string; adapter_version: string; posting_id: string; company_name: string; title: string; questions: readonly FormQuestion[] };

export function snapshotIssues(snapshot: FormSnapshot, expected: SnapshotExpectation): Issue[] {
  const issues: Issue[] = [];
  if (snapshot.site_id !== expected.site_id || snapshot.adapter_version !== expected.adapter_version) issues.push({ code: 'ADAPTER_MISMATCH', message: '지원 폼의 사이트 또는 adapter 버전이 다릅니다.' });
  if (snapshot.posting.posting_id !== expected.posting_id) issues.push({ code: 'POSTING_MISMATCH', message: '열린 지원 폼이 이 공고의 폼이 아닙니다.' });
  if (snapshot.posting.company_name !== expected.company_name) issues.push({ code: 'COMPANY_MISMATCH', message: `지원 폼의 회사명이 공고(${expected.company_name})와 다릅니다.` });
  if (snapshot.posting.title !== expected.title) issues.push({ code: 'TITLE_MISMATCH', message: `지원 폼의 직무명이 공고(${expected.title})와 다릅니다.` });
  for (const question of snapshot.questions) {
    const known = expected.questions.find(item => item.question_id === question.question_id);
    if (!known) issues.push({ code: 'UNSUPPORTED_QUESTION', message: `처리할 수 없는 문항이 있습니다: '${question.label}'. 직접 확인이 필요합니다.` });
    else if (known.label !== question.label || known.kind !== question.kind || known.required !== question.required || known.max_length !== question.max_length) issues.push({ code: 'FORM_CHANGED', message: `'${known.label}' 문항의 형식이 바뀌었습니다.` });
  }
  for (const question of expected.questions) {
    if (question.required && !snapshot.questions.some(item => item.question_id === question.question_id)) issues.push({ code: 'FORM_CHANGED', message: `필수 문항 '${question.label}'을(를) 폼에서 찾지 못했습니다.` });
  }
  if (!snapshot.file || snapshot.file.field !== FILE_FIELD || !/application\/pdf|\.pdf/i.test(snapshot.file.accept)) issues.push({ code: 'FILE_INPUT_UNSUPPORTED', message: 'PDF 이력서를 첨부할 입력란을 찾지 못했습니다.' });
  return issues;
}

export function parseReadback(value: unknown): Readback | null {
  if (!isObject(value) || !keysAre(value, ['answers', 'file']) || !Array.isArray(value.answers) || value.answers.length > 50) return null;
  const answers: Readback['answers'] = [];
  for (const item of value.answers) {
    if (!isObject(item) || !keysAre(item, ['question_id', 'value']) || typeof item.question_id !== 'string' || !ID.test(item.question_id) || !text(item.value, 100_000)) return null;
    answers.push({ question_id: item.question_id, value: item.value as string });
  }
  let file: Readback['file'] = null;
  if (value.file !== null) {
    const raw = value.file;
    if (!isObject(raw) || !keysAre(raw, ['name', 'size', 'type', 'sha256']) || !text(raw.name, 300) || !text(raw.type, 100) || !Number.isInteger(raw.size) || typeof raw.sha256 !== 'string' || !HASH.test(raw.sha256)) return null;
    file = { name: raw.name as string, size: raw.size as number, type: raw.type as string, sha256: raw.sha256 };
  }
  return { answers, file };
}

// 다시 읽은 값이 승인할 답변·파일과 정확히 같은지. 파일은 페이지에 들어간 bytes hash로 비교한다.
export function readbackIssues(readback: Readback, answers: Answer[], questions: readonly FormQuestion[], artifact: { sha256: string; byte_size: number }): Issue[] {
  const issues: Issue[] = [];
  for (const question of questions) {
    const expected = fillValue(question, answers.find(item => item.question_id === question.question_id)?.answer ?? '');
    const actual = readback.answers.find(item => item.question_id === question.question_id)?.value ?? '';
    if (actual !== expected) issues.push({ code: 'ANSWER_MISMATCH', message: `'${question.label}' 입력값이 승인할 답변과 다릅니다.` });
  }
  for (const item of readback.answers) {
    if (!questions.some(question => question.question_id === item.question_id) && item.value !== '') issues.push({ code: 'UNEXPECTED_VALUE', message: '처리하지 않는 문항에 값이 들어 있습니다.' });
  }
  if (!readback.file) issues.push({ code: 'FILE_MISSING', message: '이력서 파일이 첨부되지 않았습니다.' });
  else {
    if (readback.file.sha256 !== artifact.sha256) issues.push({ code: 'FILE_HASH_MISMATCH', message: '첨부된 파일이 확정한 PDF와 다릅니다.' });
    if (readback.file.size !== artifact.byte_size) issues.push({ code: 'FILE_SIZE_MISMATCH', message: '첨부된 파일 크기가 확정한 PDF와 다릅니다.' });
    if (readback.file.type !== 'application/pdf') issues.push({ code: 'FILE_TYPE_MISMATCH', message: '첨부된 파일 형식이 PDF가 아닙니다.' });
  }
  return issues;
}
