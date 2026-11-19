import { createHash } from 'node:crypto';
import { CONSENT_ANSWER } from './self-form.ts';
import type { Answer, FormQuestion, Issue } from './types.ts';

// 지원 답변 검증과 payload hash. payload hash는 회사·공고 snapshot·이력서 revision·실제 파일 hash·전체 답변을 묶는 내용 식별자다.

const ANSWER_KEYS = ['answer', 'question_id', 'question_text', 'source', 'source_ids'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
// 줄바꿈은 여러 줄 문항에서만 허용한다. 그 밖의 제어 문자는 받지 않는다.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export const userAnswerSource = (questionId: string) => `ua_${questionId}`;

// 키를 정렬한 JSON. 같은 내용이면 같은 hash가 나오게 한다.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

export type AnswerParse = { ok: true; answers: Answer[] } | { ok: false; code: string; message: string };

// 형식 검증. 빈 답변은 초안에서 허용하고(answerIssues가 제출 전 막는다), 문항·출처·길이는 여기서 막는다.
export function parseAnswers(value: unknown, questions: readonly FormQuestion[]): AnswerParse {
  if (!Array.isArray(value) || value.length > questions.length) return { ok: false, code: 'ANSWERS_INVALID', message: '답변 목록 형식이 올바르지 않습니다.' };
  const seen = new Set<string>();
  const answers: Answer[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join() !== ANSWER_KEYS.join()) return { ok: false, code: 'ANSWERS_INVALID', message: '답변 항목 형식이 올바르지 않습니다.' };
    const { question_id: id, question_text: text, answer, source, source_ids: sources } = item as Record<string, unknown>;
    const question = questions.find(entry => entry.question_id === id);
    if (!question || seen.has(question.question_id)) return { ok: false, code: 'ANSWER_QUESTION_UNKNOWN', message: '이 지원 폼에 없는 문항이거나 중복된 답변입니다.' };
    seen.add(question.question_id);
    if (text !== question.label) return { ok: false, code: 'ANSWER_QUESTION_TEXT_MISMATCH', message: `'${question.label}' 문항의 문구가 다릅니다.` };
    if (typeof answer !== 'string') return { ok: false, code: 'ANSWERS_INVALID', message: '답변은 문자열이어야 합니다.' };
    // 한 줄 입력란(특히 email)은 브라우저가 앞뒤 공백을 지우므로 저장 전에 같은 모양으로 맞춘다.
    const unified = answer.replace(/\r\n?/g, '\n').normalize('NFC');
    const normalized = question.kind === 'textarea' ? unified : unified.trim();
    if (normalized.length > question.max_length) return { ok: false, code: 'ANSWER_TOO_LONG', message: `'${question.label}' 답변은 ${question.max_length}자 이하로 써 주세요.` };
    if (CONTROL.test(normalized) || (question.kind !== 'textarea' && normalized.includes('\n'))) return { ok: false, code: 'ANSWER_CHARACTERS_INVALID', message: `'${question.label}' 답변에 쓸 수 없는 문자가 있습니다.` };
    // 현재 자체 폼 문항은 사용자가 직접 쓴 답변만 받는다. 확정 사실·정책 답변은 해당 근거 검증을 구현한 뒤 연다.
    if (source !== 'user_answer') return { ok: false, code: 'ANSWER_SOURCE_UNSUPPORTED', message: '현재는 사용자가 직접 작성한 답변만 사용할 수 있습니다.' };
    if (!Array.isArray(sources) || sources.length !== 1 || sources[0] !== userAnswerSource(question.question_id)) return { ok: false, code: 'ANSWER_SOURCE_INVALID', message: '답변 출처 표시가 올바르지 않습니다.' };
    answers.push({ question_id: question.question_id, question_text: question.label, answer: normalized, source: 'user_answer', source_ids: [userAnswerSource(question.question_id)] });
  }
  return { ok: true, answers: sortAnswers(answers) };
}

export const sortAnswers = (answers: Answer[]) => [...answers].sort((a, b) => (a.question_id < b.question_id ? -1 : 1));

// 제출 전 완결성 검사: 필수 문항·이메일 형식·동의 문항.
export function answerIssues(answers: Answer[], questions: readonly FormQuestion[]): Issue[] {
  const issues: Issue[] = [];
  for (const question of questions) {
    const value = answers.find(item => item.question_id === question.question_id)?.answer.trim() ?? '';
    if (question.required && !value) issues.push({ code: 'ANSWER_REQUIRED', message: `'${question.label}' 답변이 필요합니다.` });
    else if (question.kind === 'email' && value && !EMAIL.test(value)) issues.push({ code: 'ANSWER_EMAIL_INVALID', message: '이메일 형식을 확인해 주세요.' });
    else if (question.kind === 'checkbox' && value && value !== CONSENT_ANSWER) issues.push({ code: 'ANSWER_CONSENT_INVALID', message: `'${question.label}'에는 '${CONSENT_ANSWER}'만 답할 수 있습니다.` });
  }
  return issues;
}

export type PayloadParts = { job_snapshot_id: string; job_content_hash: string; resume_revision_id: string; artifact_id: string; artifact_sha256: string; answers: Answer[] };

export function payloadHash(parts: PayloadParts): string {
  return sha256(canonicalJson({ ...parts, answers: sortAnswers(parts.answers) }));
}

// 확장이 폼에 넣을 값. 체크박스는 'checked' 또는 ''로 나타낸다(readback도 같은 표현).
export function fillValue(question: FormQuestion, answer: string): string {
  return question.kind === 'checkbox' ? (answer === CONSENT_ANSWER ? 'checked' : '') : answer;
}
