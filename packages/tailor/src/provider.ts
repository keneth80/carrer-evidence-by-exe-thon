import { explainMatch } from '../../search/src/match.ts';
import type { JobRequirement } from '../../search/src/types.ts';
import { TAILORED_SECTION } from './types.ts';
import type { FactLike, ProposedChange, ResumeBlock } from './types.ts';

// 대화 provider 경계. 제품 대화 모델은 이 interface를 구현해 별도 설정으로 연결한다(Claude Code는 개발 도구이며 런타임이 아니다).
// 응답은 일반 답변(reply)과 실제 문서 변경안(changes)·확인 질문(questions)으로 나뉜다.

export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type ChatJob = { company_name: string; title: string; content_text: string; requirements: JobRequirement[] };
// call: 유료 호출 원장에 남길 작업·lease generation. live provider는 이 값 없이 호출하지 않는다.
export type ChatCallContext = { workspaceId: string; taskId: string; leaseGeneration: number };
export type ChatInput = { job: ChatJob; facts: FactLike[]; blocks: ResumeBlock[]; history: ChatTurn[]; message: string; signal?: AbortSignal; call?: ChatCallContext };
export type ChatOutput = { reply: string; changes: ProposedChange[]; questions: string[] };
export type ChatProvider = { readonly mode: 'mock' | 'live'; respond(input: ChatInput): Promise<ChatOutput> };

// provider 응답 형식 검사. live 모델이 계약과 다른 모양을 돌려주면 저장 전에 거절한다.
const OPERATIONS = ['replace', 'insert', 'remove', 'reorder'];
const isText = (value: unknown, max: number, min = 0) => typeof value === 'string' && value.length >= min && value.length <= max;
export function isChatOutput(value: unknown): value is ChatOutput {
  if (typeof value !== 'object' || value === null) return false;
  const output = value as Record<string, unknown>;
  if (!isText(output.reply, 4000) || !Array.isArray(output.changes) || output.changes.length > 20 || !Array.isArray(output.questions) || output.questions.length > 10) return false;
  if (!output.questions.every(item => isText(item, 500, 1))) return false;
  return output.changes.every(item => {
    if (typeof item !== 'object' || item === null) return false;
    const change = item as Record<string, unknown>;
    return OPERATIONS.includes(String(change.operation)) && isText(change.block_id, 128, 1)
      && (change.before === null || isText(change.before, 2000)) && (change.after === null || isText(change.after, 2000))
      && Array.isArray(change.fact_ids) && change.fact_ids.length <= 50 && change.fact_ids.every(id => isText(id, 128, 1))
      && isText(change.reason, 500, 1) && typeof change.needs_fact_confirmation === 'boolean';
  });
}

// transmission: live 호출이 실제로 나갔는지. 알 수 없으면 'unknown'으로 남겨 자동 재시도를 막는다.
export class ChatProviderError extends Error {
  readonly code: string;
  readonly transmission: 'not_dispatched' | 'completed' | 'unknown';
  constructor(code: string, message: string, transmission: 'not_dispatched' | 'completed' | 'unknown' = 'completed') {
    super(message);
    this.name = 'ChatProviderError';
    this.code = code;
    this.transmission = transmission;
  }
}

// ---- mock: 결정적 규칙으로 정상·질문·사용자 진술·실패·늦은 응답을 재현한다. 응답 문장은 확정 사실 문장만 조합한다.

const ASCII = /^[a-z0-9.+#-]+$/;
function mentions(text: string, term: string): boolean {
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase().trim();
  if (!needle) return false;
  if (!ASCII.test(needle)) return haystack.includes(needle);
  return new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(haystack);
}

// 확정 경력에 없을 수 있는 강조 요청 단어. 근거가 없으면 문장을 만들지 않고 질문한다.
const ASK_TOPICS: [RegExp, string][] = [
  [/리딩|리더|리드|이끌/, '리딩'], [/관리|매니징/, '관리'], [/성과|수치|숫자|개선율|지표/, '성과 수치'], [/총괄|책임/, '책임 범위'],
];
const REQUEST = /(해\s*줘|해\s*주세요|드러내|강조|보여|넣어|추가해|바꿔|맞춰|정리해)/;
const STATEMENT = /(했어요|했습니다|했었어요|맡았어요|맡았습니다|담당했어요|이끌었어요|리딩했어요|진행했어요)\s*[.!]?\s*$/;

// 진술 문장에서 만든 블록 ID. 대화 길이와 무관하게 문장마다 다르다(같은 문장이면 같은 ID).
function statementBlockId(text: string): string {
  let hash = 5381;
  for (const char of text) hash = ((hash * 33) ^ char.codePointAt(0)!) >>> 0;
  return `blk_stmt_${hash.toString(36)}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new ChatProviderError('ABORTED', '응답 생성을 중단했습니다.')); }, { once: true });
  });
}

// 공고 요구와 확정 경력의 연결은 검색 결과 화면과 같은 규칙(explainMatch)을 쓴다.
function linkedFacts(input: ChatInput): Map<string, FactLike[]> {
  const byId = new Map(input.facts.map(fact => [fact.id, fact]));
  const explained = explainMatch(input.facts, [], input.job);
  return new Map(explained.reasons.map(reason => [reason.requirement_id, reason.fact_ids.map(id => byId.get(id)).filter((fact): fact is FactLike => Boolean(fact))]));
}

function tailorToJob(input: ChatInput): ChatOutput {
  const linked = linkedFacts(input);
  const matchedSkills = [...new Map([...linked.values()].flat().filter(fact => fact.category === 'skill').map(fact => [fact.id, fact])).values()];
  const requested = input.facts.filter(fact => fact.category === 'skill' && mentions(input.message, fact.statement));
  const priority = [...new Map([...requested, ...matchedSkills].map(fact => [fact.id, fact])).values()];
  const changes: ProposedChange[] = [];
  const skillsBlock = input.blocks.find(block => block.id === 'blk_skills');
  const skillFacts = input.facts.filter(fact => fact.category === 'skill' && skillsBlock?.fact_ids.includes(fact.id));
  if (skillsBlock && priority.length) {
    const ordered = [...priority.filter(fact => skillFacts.some(item => item.id === fact.id)), ...skillFacts.filter(fact => !priority.some(item => item.id === fact.id))];
    const text = ordered.map(fact => fact.statement).join(' · ');
    if (text !== skillsBlock.text) {
      changes.push({ operation: 'replace', block_id: skillsBlock.id, before: skillsBlock.text, after: text, fact_ids: ordered.map(fact => fact.id), reason: `공고 요구와 연결되는 기술(${priority.map(fact => fact.statement).join(', ')})을 앞에 배치합니다.`, needs_fact_confirmation: false });
    }
  }
  const role = input.facts.find(fact => fact.category === 'role');
  if (role && priority.length) {
    const summary = [role, ...priority.slice(0, 4)];
    const text = summary.map(fact => fact.statement).join(' · ');
    const existing = input.blocks.find(block => block.section === TAILORED_SECTION);
    if (!existing) {
      changes.push({ operation: 'insert', block_id: 'blk_tailored_summary', before: null, after: text, fact_ids: summary.map(fact => fact.id), reason: `${input.job.company_name} ${input.job.title} 공고의 핵심 요구와 연결된 확정 경력을 요약 맨 위에 둡니다.`, needs_fact_confirmation: false });
    } else if (existing.text !== text) {
      changes.push({ operation: 'replace', block_id: existing.id, before: existing.text, after: text, fact_ids: summary.map(fact => fact.id), reason: '요청한 강조점을 맞춤 요약에 반영합니다.', needs_fact_confirmation: false });
    }
  }
  // 요구 문장과 겹치는 담당 업무 문장은 같은 구역 맨 앞으로 옮긴다.
  const requirementText = input.job.requirements.map(item => item.text).join('\n');
  const duty = input.blocks.find(block => block.section === '경력 내용' && priority.some(fact => mentions(block.text, fact.statement)) && mentions(requirementText, priority[0]?.statement ?? ''));
  const firstDuty = input.blocks.find(block => block.section === '경력 내용');
  if (duty && firstDuty && duty.id !== firstDuty.id) {
    changes.push({ operation: 'reorder', block_id: duty.id, before: null, after: null, fact_ids: duty.fact_ids, reason: '공고 요구 기술이 드러나는 업무 문장을 먼저 보여줍니다.', needs_fact_confirmation: false });
  }
  if (changes.length === 0) {
    return { reply: '현재 문서에서 공고 요구와 연결된 경력이 이미 앞쪽에 있어요. 강조하고 싶은 기술이나 경험을 알려 주세요.', changes: [], questions: [] };
  }
  const named = [...linked.keys()].map(id => input.job.requirements.find(item => item.id === id)?.text).filter(Boolean).slice(0, 2);
  return { reply: `공고 요구${named.length ? `(${named.map(text => `‘${text}’`).join(', ')})` : ''}와 연결되는 확정 경력을 앞으로 옮기는 수정안을 만들었어요. 변경 전후를 확인하고 적용해 주세요. 새로운 경력 사실은 추가하지 않았습니다.`, changes, questions: [] };
}

export function createMockChatProvider(options: { slowMs?: number } = {}): ChatProvider {
  return {
    mode: 'mock',
    async respond(input) {
      const message = input.message.trim();
      if (message.includes('[mock:fail]')) throw new ChatProviderError('MOCK_CHAT_FAILURE', 'mock 대화 실패를 재현했습니다.');
      if (message.includes('[mock:slow]')) await sleep(options.slowMs ?? 2_500, input.signal);
      const clean = message.replace(/\[mock:[a-z]+\]/g, '').trim();
      // 사용자가 자기 경험을 서술하면 문장을 그대로 경력 정보 후보로 제시한다. 확인 전에는 적용할 수 없다.
      if (STATEMENT.test(clean) && !REQUEST.test(clean)) {
        return {
          reply: '말씀하신 내용은 아직 확정 경력에 없어요. 아래 문장을 경력 정보에 추가하면 이력서에 반영할 수 있습니다. 내용이 정확한지 확인해 주세요.',
          changes: [{ operation: 'insert', block_id: statementBlockId(clean), before: null, after: clean, fact_ids: [], reason: '사용자 진술 — 경력 정보로 확인한 뒤에만 반영합니다.', needs_fact_confirmation: true }],
          questions: ['이 내용을 경력 정보에 추가할까요?'],
        };
      }
      const factText = input.facts.map(fact => fact.statement).join('\n');
      const missing = ASK_TOPICS.find(([pattern]) => pattern.test(clean) && !pattern.test(factText));
      if (missing) {
        return { reply: `확정 경력에서 ‘${missing[1]}’ 근거를 찾지 못했어요. 몇 명 규모로 어떤 일을 맡았는지 한 문장으로 알려 주시면, 경력 정보로 확인한 뒤 반영할게요.`, changes: [], questions: [`${missing[1]} 경험의 범위(인원·역할·기간)는 어떻게 되나요?`] };
      }
      return tailorToJob({ ...input, message: clean });
    },
  };
}
