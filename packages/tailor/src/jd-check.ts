import { containsTerm, explainMatch } from '../../search/src/match.ts';
import type { JobRequirement } from '../../search/src/types.ts';
import type { ChatCallContext, ChatJob } from './provider.ts';
import type { FactLike, ProposedChange } from './types.ts';

// 공고(JD) 맞춤 점검(DECISIONS S1-18). 첫 턴은 ① 요구사항 대조(모델 없음) → ② AI 점검(질문만)이다.
// 대조는 검색 결과 화면과 같은 연결 규칙(explainMatch)을 쓰고, 근거를 찾지 못한 요구를 '경험 없음'으로 단정하지 않는다.
// 이 파일은 node 전용 모듈을 쓰지 않는다(웹 화면이 같은 타입을 쓴다).

export type RequirementStatus = 'met' | 'weak' | 'missing';
export type RequirementCheck = { requirement_id: string; requirement: string; importance: JobRequirement['importance']; status: RequirementStatus; fact_ids: string[]; note: string };
export type JdFinding = { requirement_id: string; fact_ids: string[]; title: string; question: string };
export type JdReviewInput = { job: ChatJob; facts: FactLike[]; checks: RequirementCheck[]; signal?: AbortSignal; call?: ChatCallContext };
export type CriticChange = { index: number; operation: ProposedChange['operation']; before: string | null; after: string | null; fact_ids: string[] };
export type JdExtractInput = { job: ChatJob; signal?: AbortSignal; call?: ChatCallContext };
export type JdCriticInput = { job: ChatJob; facts: FactLike[]; userMessages: { id: string; content: string }[]; changes: CriticChange[]; signal?: AbortSignal; call?: ChatCallContext };
// ②·④ 단계 provider. 대화 수정(③)은 기존 ChatProvider.respond를 그대로 쓴다.
// extract: 요구사항 목록이 없는 공고(실시간 검색 요약)에서 ① 단계가 요구를 뽑는다. 없으면 추출 없이 대조만 한다.
export type TailorStageProvider = { readonly mode: 'mock' | 'live'; extract?(input: JdExtractInput): Promise<unknown>; review(input: JdReviewInput): Promise<unknown>; critic(input: JdCriticInput): Promise<unknown> };

export const JD_LIMITS = { findings: 8, questions: 8, reply: 2000, title: 80, question: 400, requirements: 10, requirementText: 120 } as const;
// 이름만 있는 사실(기술·직무·회사·기간·지역). 나머지(업무·성과·학력·자격·기타)는 문장 근거다.
const NAME_CATEGORIES = new Set(['skill', 'role', 'employer', 'period', 'location']);
const isSentence = (fact: FactLike) => !NAME_CATEGORIES.has(fact.category);
const NOTE: Record<RequirementStatus, string> = {
  met: '확정 경력의 업무·성과 문장에 근거가 있어요.',
  weak: '기술·직무 이름만 있고, 어디에 썼는지 보여 주는 업무 문장이 없어요.',
  missing: '확정 경력에서 근거를 찾지 못했어요(경험이 없다는 뜻은 아니에요. 단정하지 않아요).',
};

// 요구마다 충족·근거 약함·미기재로 나눈다. 기술 이름만 연결되면, 그 기술을 쓴 업무 문장이 있을 때만 충족으로 본다.
export function checkRequirements(facts: FactLike[], job: Pick<ChatJob, 'title' | 'content_text' | 'requirements'>): RequirementCheck[] {
  const linked = new Map(explainMatch(facts, [], job).reasons.map(reason => [reason.requirement_id, reason.fact_ids]));
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  const sentences = facts.filter(isSentence);
  return job.requirements.map(requirement => {
    const ids = linked.get(requirement.id) ?? [];
    const named = ids.map(id => byId.get(id)).filter((fact): fact is FactLike => Boolean(fact));
    const direct = named.filter(isSentence);
    const used = named.filter(fact => fact.category === 'skill').flatMap(skill => sentences.filter(fact => containsTerm(fact.statement, skill.statement.trim())));
    const evidence = [...new Set([...ids, ...used.map(fact => fact.id)])];
    const status: RequirementStatus = ids.length === 0 ? 'missing' : direct.length > 0 || used.length > 0 ? 'met' : 'weak';
    return { requirement_id: requirement.id, requirement: requirement.text, importance: requirement.importance, status, fact_ids: evidence, note: NOTE[status] };
  });
}

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;

// ② AI 점검 응답을 서버가 다시 거른다: 근거 약함·미기재 요구에 대한 질문만, fact id는 확정 경력에 있는 것만 남긴다.
export function screenJdReview(raw: unknown, checks: RequirementCheck[], facts: FactLike[]): { reply: string; findings: JdFinding[]; questions: string[] } | null {
  const value = record(raw);
  if (!value || typeof value.reply !== 'string' || value.reply.length > JD_LIMITS.reply || !Array.isArray(value.findings) || !Array.isArray(value.questions)) return null;
  const open = new Set(checks.filter(check => check.status !== 'met').map(check => check.requirement_id));
  const known = new Set(facts.map(fact => fact.id));
  const findings: JdFinding[] = [];
  for (const entry of value.findings) {
    const item = record(entry);
    const question = text(item?.question, JD_LIMITS.question);
    const requirementId = typeof item?.requirement_id === 'string' ? item.requirement_id : '';
    if (!item || !question || !open.has(requirementId) || findings.some(found => found.requirement_id === requirementId)) continue;
    const factIds = Array.isArray(item.fact_ids) ? item.fact_ids.filter((id): id is string => typeof id === 'string' && known.has(id)) : [];
    findings.push({ requirement_id: requirementId, fact_ids: [...new Set(factIds)], title: text(item.title, JD_LIMITS.title) ?? '확인할 요구', question });
    if (findings.length >= JD_LIMITS.findings) break;
  }
  const questions = value.questions.map(item => text(item, JD_LIMITS.question)).filter((item): item is string => Boolean(item));
  return { reply: value.reply.trim(), findings, questions: [...new Set(questions)].slice(0, JD_LIMITS.questions) };
}

// ① 추출 응답을 서버가 다시 거른다(품질 검증 2026-11-20: 실시간 검색 공고는 requirements=[]).
// - source_quote는 공고 글에 그대로 있어야 한다(띄어쓰기 차이만 허용). 지어낸 인용은 뺀다.
// - text의 영문 기술명·숫자는 인용에 있어야 한다(요구를 키우거나 바꾸지 않게).
// - 중요도는 인용에 '필수'·'우대'가 있으면 그것을 따른다. id는 서버가 붙인다. 형식이 틀리면 null(닫힌 쪽).
const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
const TEXT_TOKENS = /\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9.+#-]*/g;
function importanceOf(quote: string, given: unknown): JobRequirement['importance'] {
  if (/필수|자격\s*요건|required/i.test(quote)) return 'required';
  if (/우대|preferred|plus/i.test(quote)) return 'preferred';
  return given === 'required' || given === 'preferred' ? given : 'unknown';
}
export function screenExtractedRequirements(raw: unknown, contentText: string): JobRequirement[] | null {
  const value = record(raw);
  if (!value || !Array.isArray(value.requirements)) return null;
  const source = squash(contentText);
  const kept: JobRequirement[] = [];
  for (const entry of value.requirements) {
    const item = record(entry);
    const requirement = text(item?.text, JD_LIMITS.requirementText);
    const quote = typeof item?.source_quote === 'string' ? squash(item.source_quote) : '';
    if (!item || !requirement || quote.length < 2 || !source.includes(quote)) continue;
    if ((requirement.match(TEXT_TOKENS) ?? []).some(token => !quote.includes(token))) continue;
    if (kept.some(found => found.text === requirement)) continue;
    kept.push({ id: `req_x${kept.length + 1}`, text: requirement, importance: importanceOf(quote, item.importance), source_quote: quote });
    if (kept.length >= JD_LIMITS.requirements) break;
  }
  return kept;
}

// ---- mock(규칙 기반 합성 응답). 질문만 만들고, 근거 검토는 근거에 없는 숫자·영문 기술명·범위 표현이 있으면 뺀다.

const CRITIC_TOKENS = /\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9.+#-]*|리드|리딩|총괄|주도|이끌|책임|팀장/g;
function mockQuestion(check: RequirementCheck, facts: FactLike[]): JdFinding {
  const names = facts.filter(fact => check.fact_ids.includes(fact.id)).map(fact => fact.statement).join(', ');
  return check.status === 'weak'
    ? { requirement_id: check.requirement_id, fact_ids: check.fact_ids, title: '어디에 썼는지가 없어요', question: `${names}을(를) 어떤 업무에서 썼는지 한두 문장으로 알려 주실 수 있나요?` }
    : { requirement_id: check.requirement_id, fact_ids: [], title: '확정 경력에서 찾지 못했어요', question: `‘${check.requirement}’ 관련해 직접 해 본 일이 있나요? 있다면 무엇을 했는지 알려 주세요. 없으면 넘어가도 괜찮아요.` };
}

function mockVerdict(change: CriticChange, sources: string): { index: number; verdict: 'keep' | 'drop'; reason: string } {
  if (change.after === null) return { index: change.index, verdict: 'keep', reason: change.operation === 'reorder' ? '순서만 바꿔요.' : '문장을 빼기만 해요.' };
  const missing = [...new Set(change.after.match(CRITIC_TOKENS) ?? [])].filter(token => !sources.includes(token));
  return missing.length > 0
    ? { index: change.index, verdict: 'drop', reason: `근거에 없는 표현이 있어요: ${missing.join(', ')}` }
    : { index: change.index, verdict: 'keep', reason: '확정 경력·답변에 있는 내용만 썼어요.' };
}

// mock 추출: 글머리표·줄 단위 구절 중 요구 표현(경험·필수·우대·이상 등)이 있는 것만 그대로 인용한다.
const REQUIREMENT_SIGNAL = /경험|필수|우대|이상|능숙|역량|자격|이해|가능하신/;
function mockExtract(contentText: string) {
  const parts = contentText.split(/\n|[✓✔•▶■◦●]|\s-\s|\.\s/).map(squash).filter(part => part.length >= 4 && part.length <= JD_LIMITS.requirementText);
  const requirements = parts.filter(part => REQUIREMENT_SIGNAL.test(part) && !/#|D-\d/.test(part)).map(part => ({ text: part, importance: 'unknown', source_quote: part }));
  return { requirements };
}

export function createMockTailorStageProvider(): TailorStageProvider {
  return {
    mode: 'mock',
    async extract(input) {
      return mockExtract(input.job.content_text);
    },
    async review(input) {
      const open = input.checks.filter(check => check.status !== 'met');
      const findings = open.slice(0, JD_LIMITS.findings).map(check => mockQuestion(check, input.facts));
      return { reply: `mock 점검(규칙 기반 합성 응답): 요구사항 ${input.checks.length}개 중 근거가 약하거나 찾지 못한 ${open.length}개를 물어볼게요. 답한 내용으로 수정안을 만들어 드려요.`, findings, questions: [] };
    },
    async critic(input) {
      const sources = [...input.facts.map(fact => fact.statement), ...input.userMessages.map(message => message.content), ...input.changes.map(change => change.before ?? '')].join('\n');
      return { verdicts: input.changes.map(change => mockVerdict(change, sources)) };
    },
  };
}
