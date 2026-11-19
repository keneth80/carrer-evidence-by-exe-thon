import { parseJobAttributes } from '../../search/src/job-attributes.ts';
import { requirementTerms } from '../../search/src/match.ts';
import type { JobRequirement } from '../../search/src/types.ts';
import { TAILORED_SECTION } from '../../tailor/src/types.ts';
import type { ResumeBlock } from '../../tailor/src/types.ts';
import type { Issue } from './types.ts';

// S06 유사 공고 판단(순수 로직). 유사도는 직무 계열·책임 수준·기술·업무 내용으로 설명하며, 지원 가능 여부(조건·권한)와 섞지 않는다.

export type SimilarJob = { job_key: string; company_name: string; title: string; content_text: string; requirements: JobRequirement[] };
export type SimilarityReason = { kind: 'role' | 'level' | 'skills' | 'duties'; matched: boolean; text: string };
export type Similarity = { score: number; reasons: SimilarityReason[]; shared_skills: string[] };

const FAMILIES: [string, string[]][] = [
  ['프론트엔드', ['프론트엔드', 'frontend', 'front-end']],
  ['백엔드·서버', ['백엔드', 'backend', '서버']],
  ['풀스택', ['풀스택', 'fullstack', 'full-stack']],
  ['데이터', ['데이터', 'data']],
  ['디자인', ['디자이너', '디자인', 'designer']],
  ['모바일', ['모바일', 'ios', 'android']],
];
const SKILL_STOP = new Set(['or', 'and', 'the', 'api', 'ui', 'ux']);

export const companyKey = (name: string) => name.replace(/\((합성|주식회사)\)|㈜|주식회사|\s+/g, '').toLowerCase();

function family(title: string): string | null {
  const lower = title.toLowerCase();
  return FAMILIES.find(([, tokens]) => tokens.some(token => lower.includes(token)))?.[0] ?? null;
}

type Level = 'junior' | 'mid' | 'senior';
const LEVEL_LABEL: Record<Level, string> = { junior: '주니어', mid: '경력', senior: '시니어' };
function level(job: SimilarJob): { level: Level | null; detail: string } {
  if (/시니어|리드|senior|lead/i.test(job.title)) return { level: 'senior', detail: '직무명에 시니어·리드' };
  if (/주니어|신입|junior/i.test(job.title)) return { level: 'junior', detail: '직무명에 주니어·신입' };
  const seniority = parseJobAttributes(job.content_text).seniority;
  const years = seniority ? Number(/(\d+)\s*년/.exec(seniority)?.[1] ?? NaN) : NaN;
  if (Number.isFinite(years)) return { level: years >= 5 ? 'senior' : years >= 1 ? 'mid' : 'junior', detail: `경력 조건 ${seniority}` };
  return { level: null, detail: '경력 조건 정보 없음' };
}

// 주요 업무 줄(- 로 시작)과 자격 요건에서 기술명(영문)과 업무 표현(한글)을 뽑는다.
function sectionLines(content: string, header: string): string[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === header);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim().startsWith('- ')) break;
    out.push(line.trim().slice(2));
  }
  return out;
}

export function skillTerms(job: SimilarJob): string[] {
  const text = [...job.requirements.map(item => item.text), ...sectionLines(job.content_text, '주요 업무')].join('\n');
  return [...new Set([...text.matchAll(/[A-Za-z][A-Za-z0-9.+#-]*/g)].map(match => match[0].replace(/[.-]+$/, '').toLowerCase()).filter(term => term.length >= 2 && !SKILL_STOP.has(term)))].sort();
}

function dutyTerms(job: SimilarJob): string[] {
  // 영문 기술명과 '개발합니다' 같은 서술어는 업무 내용 비교에서 뺀다.
  return [...new Set(sectionLines(job.content_text, '주요 업무').flatMap(line => requirementTerms(line)).map(term => term.replace(/[.,]+$/, '')).filter(term => term.length >= 2 && !/[a-z]/.test(term) && !/니다$/.test(term)))];
}

// 작은 집합끼리 비교하므로 교집합 / 더 작은 집합 크기(overlap 계수)를 쓴다.
const overlap = (a: string[], b: string[]) => (a.length && b.length ? a.filter(item => b.includes(item)).length / Math.min(a.length, b.length) : 0);

export function similarity(seed: SimilarJob, candidate: SimilarJob): Similarity {
  const reasons: SimilarityReason[] = [];
  const seedFamily = family(seed.title);
  const candidateFamily = family(candidate.title);
  const roleScore = seedFamily && seedFamily === candidateFamily ? 1 : seedFamily === null && candidateFamily === null ? 0.5 : 0;
  reasons.push(roleScore === 1
    ? { kind: 'role', matched: true, text: `직무 계열이 같습니다: ${seedFamily}` }
    : { kind: 'role', matched: false, text: `직무 계열이 다릅니다: 기준 ${seedFamily ?? '확인 안 됨'} · 이 공고 ${candidateFamily ?? '확인 안 됨'}` });
  const seedLevel = level(seed);
  const candidateLevel = level(candidate);
  const levelScore = seedLevel.level && candidateLevel.level ? (seedLevel.level === candidateLevel.level ? 1 : 0) : 0.5;
  reasons.push(levelScore === 1
    ? { kind: 'level', matched: true, text: `책임 수준이 비슷합니다(${LEVEL_LABEL[candidateLevel.level!]}, ${candidateLevel.detail})` }
    : levelScore === 0
      ? { kind: 'level', matched: false, text: `책임 수준이 다를 수 있습니다: 기준 ${LEVEL_LABEL[seedLevel.level!]} · 이 공고 ${LEVEL_LABEL[candidateLevel.level!]}(${candidateLevel.detail})` }
      : { kind: 'level', matched: false, text: `책임 수준을 비교할 정보가 부족합니다(${candidateLevel.detail})` });
  const seedSkills = skillTerms(seed);
  const candidateSkills = skillTerms(candidate);
  const shared = seedSkills.filter(term => candidateSkills.includes(term));
  const skillScore = overlap(seedSkills, candidateSkills);
  reasons.push(shared.length
    ? { kind: 'skills', matched: true, text: `공통 기술: ${shared.join(', ')}` }
    : { kind: 'skills', matched: false, text: '기준 공고와 겹치는 기술이 없습니다' });
  const seedDuties = dutyTerms(seed);
  const candidateDuties = dutyTerms(candidate);
  const sharedDuties = seedDuties.filter(term => candidateDuties.includes(term));
  const dutyScore = overlap(seedDuties, candidateDuties);
  reasons.push(sharedDuties.length
    ? { kind: 'duties', matched: true, text: `업무 내용이 겹칩니다: ${sharedDuties.slice(0, 4).join(', ')}` }
    : { kind: 'duties', matched: false, text: '업무 내용 표현이 거의 겹치지 않습니다' });
  const score = Math.round((roleScore * 0.4 + skillScore * 0.35 + dutyScore * 0.15 + levelScore * 0.1) * 100) / 100;
  return { score, reasons, shared_skills: shared };
}

// 확정 파일을 그대로 다른 공고에 쓸 때의 점검: 기준 공고 회사명·직무명, 기준 공고 전용 요약 문구.
export function fixedDocumentIssues(blocks: ResumeBlock[], seed: SimilarJob, candidate: SimilarJob): Issue[] {
  const issues: Issue[] = [];
  const text = blocks.map(block => block.text).join('\n');
  const key = companyKey(seed.company_name);
  if (key.length >= 2 && key !== companyKey(candidate.company_name) && companyKey(text).includes(key)) {
    issues.push({ code: 'SEED_COMPANY_IN_DOCUMENT', message: `이력서에 기준 공고 회사명(${seed.company_name})이 있습니다.` });
  }
  const summary = blocks.filter(block => block.section === TAILORED_SECTION).map(block => block.text).join('\n');
  if (summary && seed.title !== candidate.title && summary.includes(seed.title)) issues.push({ code: 'SEED_SPECIFIC_PHRASE', message: `맞춤 요약에 기준 공고 직무명(${seed.title})이 있습니다.` });
  const candidateText = `${candidate.title}\n${candidate.content_text}`.toLowerCase();
  const foreign = [...new Set([...summary.matchAll(/[A-Za-z][A-Za-z0-9.+#-]*/g)].map(match => match[0].replace(/[.-]+$/, '')))].filter(term => term.length >= 2 && !candidateText.includes(term.toLowerCase()));
  if (foreign.length) issues.push({ code: 'SEED_SPECIFIC_PHRASE', message: `맞춤 요약이 이 공고에 없는 기술(${foreign.join(', ')})을 강조합니다.` });
  return issues;
}

// 이 점수 미만은 유사 공고로 보지 않는다(설명과 함께 건너뜀). 점수는 지원 가능 여부가 아니다.
export const MIN_SIMILARITY = 0.3;

export const isExcludedCompany = (company: string, excluded: string[]) => excluded.some(name => companyKey(name).length >= 2 && companyKey(company).includes(companyKey(name)));
