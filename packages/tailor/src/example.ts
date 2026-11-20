import { checkSupported } from './guard.ts';
import { findSlop } from './slop.ts';
import type { FactLike } from './types.ts';

// 점검 항목의 작성 예시(사용자 요청 2026-11-20: "질문만 하지 말고 개선안을 같이 보여 줘", DECISIONS S1-22).
// 예시는 사실이 아니라 '이렇게 쓰면 된다'는 틀이다. 확정 경력에 없는 수치·기술·범위는 [빈칸]으로 남긴다.
// 사용자가 빈칸을 채워 자기 메시지로 보내야 그 문장이 후보가 되고, 빈칸이 남은 문장은 후보가 되지 않는다.
// 이 파일은 node 전용 모듈을 쓰지 않는다(웹 화면이 hasBlank를 쓴다).

export const EXAMPLE_MAX = 300;
const BLANK = /\[[^\]\n]*\]/g;

export function hasBlank(text: string): boolean {
  return /\[[^\]\n]*\]/.test(text);
}

// AI가 쓴 예시를 거른다. 빈칸 밖의 숫자·영문 기술명·책임 범위 표현은 확정 경력(sources)에 있어야 하고,
// 빈칸 안에는 숫자를 쓰지 않는다(예시 숫자도 지어낸 수치로 읽힌다). 평가어가 있으면 뺀다. 문제가 있으면 null(항목은 남는다).
export function screenExample(value: unknown, sources: string): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > EXAMPLE_MAX) return null;
  const text = value.trim();
  if ((text.match(BLANK) ?? []).some(blank => /\d/.test(blank))) return null;
  const outside = text.replace(BLANK, ' ');
  if (checkSupported(outside, ['src'], [{ id: 'src', category: 'other', statement: sources }]).length > 0) return null;
  if (findSlop(outside, [sources]).length > 0) return null;
  return text;
}

type RuleFinding = { kind: string; fact_ids: string[] };

// 문장 끝(다./요.) 뒤에서 나눈다. 원래 문장을 그대로 쓰므로 새 사실이 생기지 않는다.
const sentencesIn = (statement: string) => statement.split(/(?<=[다요]\.)\s+/).map(part => part.trim()).filter(Boolean);

// 규칙 점검 항목의 예시(모델 없음). 원래 문장을 나누거나 평가어를 빼거나, 빈칸 틀을 보여 준다.
export function ruleExample(finding: RuleFinding, facts: FactLike[]): string | null {
  const fact = facts.find(item => item.id === finding.fact_ids[0]);
  switch (finding.kind) {
    case 'long_statement': {
      const parts = fact ? sentencesIn(fact.statement) : [];
      return parts.length >= 2 ? parts.map(part => `• ${part}`).join('\n') : '• [첫 번째로 한 일]을 했습니다.\n• [두 번째로 한 일]을 했습니다.';
    }
    case 'slop': {
      if (!fact) return null;
      const phrases = findSlop(fact.statement).map(item => item.phrase);
      const plain = phrases.reduce((text, phrase) => text.replace(phrase, ''), fact.statement).replace(/\s+/g, ' ').trim();
      return plain && plain !== fact.statement ? plain : null;
    }
    case 'broad_statement':
      return '[직접 맡은 기능·화면]을 [사용한 기술·방법]으로 개발했습니다.';
    case 'no_result':
      return '[한 일]을 해 [무엇]을 [이전 값]에서 [이후 값]으로 바꿨습니다(측정 기록이 있을 때만).';
    case 'missing_role':
      return '[회사명] | [직무, 예: 프론트엔드 개발자] | [시작 연월] ~ [끝 연월]';
    case 'missing_period':
      return '[회사명] [시작 연월] ~ [끝 연월 또는 재직 중]';
    case 'few_skills':
      return '기술: [주로 쓴 언어], [프레임워크], [도구·인프라]';
    default:
      return null;
  }
}
