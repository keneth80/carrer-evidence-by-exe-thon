import type { FactLike, ProposedChange, ResumeBlock } from './types.ts';

// 새 경력 사실이 문서에 들어가지 않게 막는 검사. 표현은 바꿀 수 있지만,
// 숫자(단위 포함)·한국어 수량 표현·영문 기술명·책임 범위 표현은 근거로 든 확정 사실 문장에 있어야 한다
// (CLAUDE.md: 새 수치·자격·역할 금지). 한국어 명사구의 의미 과장은 기계적으로 완전히 막지 못한다(DECISIONS S4-04).

export type GuardIssue = { code: 'FACT_NOT_IN_REVISION' | 'UNSUPPORTED_NUMBER' | 'UNSUPPORTED_TERM' | 'UNSUPPORTED_SCOPE'; detail: string };

// 전각 숫자·호환 문자를 일반 문자로 바꿔 비교한다(예: '１００' → '100').
const normalize = (text: string) => text.normalize('NFKC');

const SCOPE_WORDS = /(리드|리딩|리더|이끌|총괄|책임|팀장|파트장|매니저|주도|주관|지휘|전담|관리자|대표|최고|설계\s*책임|\blead\b|\bmanager\b|\bhead\b|\bCTO\b|\bCEO\b|\bPM\b|\bPO\b)/gi;
const UNIT = '(%|퍼센트|명|배|개월|개|년|건|곳|회|번|억|만|천|원|시간|일|주|위)';
const KOREAN_COUNT = new RegExp(`(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|수십|수백|수천|수만|백|천|만)\\s*${UNIT}`, 'g');

// 숫자와 바로 뒤의 단위를 한 쌍으로 본다. '30명'을 근거로 '30%'를 쓰면 다른 사실이다.
function numberTokens(text: string): { value: string; unit: string }[] {
  return [...normalize(text).matchAll(new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*${UNIT}?`, 'g'))].map(match => ({ value: match[1].replaceAll(',', ''), unit: match[2] ?? '' }));
}

function latinTerms(text: string): string[] {
  return [...normalize(text).matchAll(/[A-Za-z][A-Za-z0-9.+#-]*/g)].map(match => match[0].replace(/[.-]+$/, '').toLowerCase()).filter(term => term.length >= 1);
}

// 블록 문장이 근거 사실 범위를 넘는지 확인한다. 문제 목록이 비면 통과다.
export function checkSupported(text: string, factIds: string[], facts: FactLike[]): GuardIssue[] {
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  const issues: GuardIssue[] = [];
  const missing = factIds.filter(id => !byId.has(id));
  if (missing.length) issues.push({ code: 'FACT_NOT_IN_REVISION', detail: `근거 사실 ${missing.join(', ')}이(가) 확정 경력에 없습니다.` });
  const evidence = normalize(factIds.map(id => byId.get(id)?.statement ?? '').join('\n'));
  const evidenceTokens = numberTokens(evidence);
  const evidenceTerms = new Set(latinTerms(evidence));
  const evidenceLower = evidence.toLowerCase();
  for (const token of numberTokens(text)) {
    const supported = token.unit
      ? evidenceTokens.some(item => item.value === token.value && item.unit === token.unit)
      : evidenceTokens.some(item => item.value === token.value);
    if (!supported) issues.push({ code: 'UNSUPPORTED_NUMBER', detail: `수치 '${token.value}${token.unit}'가 근거 사실에 없습니다.` });
  }
  for (const match of normalize(text).matchAll(KOREAN_COUNT)) {
    if (!evidence.includes(match[0])) issues.push({ code: 'UNSUPPORTED_NUMBER', detail: `수량 표현 '${match[0]}'이(가) 근거 사실에 없습니다.` });
  }
  for (const term of latinTerms(text)) {
    if (!evidenceTerms.has(term)) issues.push({ code: 'UNSUPPORTED_TERM', detail: `'${term}'이(가) 근거 사실에 없습니다.` });
  }
  for (const match of normalize(text).matchAll(SCOPE_WORDS)) {
    if (!evidenceLower.includes(match[0].toLowerCase())) issues.push({ code: 'UNSUPPORTED_SCOPE', detail: `책임 범위 표현 '${match[0]}'이(가) 근거 사실에 없습니다.` });
  }
  return issues;
}

// 문장을 바꾸거나 추가하는 변경만 검사한다. 사실 확인이 필요한 변경은 확인 전에는 적용하지 않으므로 여기서 통과시킨다.
export function checkChange(change: ProposedChange, facts: FactLike[]): GuardIssue[] {
  if (change.operation !== 'replace' && change.operation !== 'insert') return [];
  if (change.needs_fact_confirmation) return [];
  return checkSupported(change.after ?? '', change.fact_ids, facts);
}

// 확정 직전 전체 문서 검사: 모든 블록이 같은 fact revision의 사실로 뒷받침되는지.
export function checkBlocks(blocks: ResumeBlock[], facts: FactLike[]): { block_id: string; issues: GuardIssue[] }[] {
  return blocks.map(block => ({ block_id: block.id, issues: checkSupported(block.text, block.fact_ids, facts) })).filter(item => item.issues.length > 0);
}

// 문서가 고정한 경력 버전 이후 사용자가 사실을 지우거나 고쳤는지: 블록이 참조하는 사실이 최신 확정 경력에
// 같은 ID·같은 문장으로 남아 있지 않으면 해당 블록을 돌려준다.
export function factDrift(blocks: ResumeBlock[], pinned: FactLike[], head: FactLike[]): string[] {
  const before = new Map(pinned.map(fact => [fact.id, fact.statement]));
  const now = new Map(head.map(fact => [fact.id, fact.statement]));
  return blocks.filter(block => block.fact_ids.some(id => !now.has(id) || now.get(id) !== before.get(id))).map(block => block.id);
}
