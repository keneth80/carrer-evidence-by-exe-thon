// 안티슬롭: AI가 새로 쓴 이력서 문장에서 상투적 자기소개·근거 없는 수식·AI 특유의 문장 장치를 찾는다(DECISIONS S4-13).
// 사용자 원문(근거 사실·바꾸기 전 문장)에 이미 있는 표현은 사용자 표현이므로 문제 삼지 않는다.
// 이 패키지는 node 전용 모듈을 쓰지 않는다(웹 화면 점검에서도 쓴다).

export type SlopKind = 'cliche' | 'unbacked_praise' | 'ai_pattern' | 'typography';
export type SlopIssue = { kind: SlopKind; phrase: string; hint: string };

type Rule = { kind: SlopKind; pattern: RegExp; hint: string };

const RULES: Rule[] = [
  // 누구에게나 붙는 자기소개 문구: 경력 근거가 아니라 다짐이다.
  { kind: 'cliche', pattern: /열정(?:적|을|으로|이)?|끊임없(?:이|는)|최선을\s*다(?:해|하|했)|도전\s*정신|성장(?:하는|하고\s*싶은)\s*(?:개발자|인재)|소통\s*능력|문제\s*해결\s*능력|책임감(?:이\s*강한|\s*있(?:는|게)|을\s*가지고)|열심히/g, hint: '다짐·성향 대신 실제로 한 일과 결과를 쓰세요.' },
  { kind: 'cliche', pattern: /다양한\s*경험을\s*바탕으로|풍부한\s*경험|폭넓은\s*경험|깊은\s*이해/g, hint: '어떤 경험인지 구체적인 업무로 바꾸세요.' },
  // 평가는 읽는 사람이 한다: 근거 수치·결과 없이 스스로 붙인 칭찬.
  { kind: 'unbacked_praise', pattern: /탁월(?:한|하게|히|합니다|하다)|뛰어(?:난|나게|납니다|나다)|우수(?:한|합니다|하다)|혁신적(?:인|으로)?|획기적(?:인|으로)?|압도적(?:인|으로)?|독보적(?:인)?|완벽(?:한|하게|히)|극대화|성공적으로|핵심적인\s*역할|중추적(?:인)?|견인(?:했|하|한)|역량을\s*발휘|가치를\s*창출|시너지|임팩트|오너십|레버리지/g, hint: '평가어 대신 확인된 사실(무엇을, 어떻게)을 쓰세요.' },
  // 생성 모델이 자주 쓰는 연결 장치: 내용 없이 문장만 길어진다.
  { kind: 'ai_pattern', pattern: /뿐만\s*아니라|더\s*나아가|나아가|이를\s*통해|에\s*그치지\s*않고|단순히\s*\S+(?:이|가)\s*아닌/g, hint: '연결어를 빼고 한 문장에 한 가지 사실만 쓰세요.' },
  { kind: 'ai_pattern', pattern: /\b(?:synergy|impact(?:ful)?|leverag(?:e|ed|ing)|passionate|seamless(?:ly)?|robust|cutting-edge|innovative|world-class|best-in-class|spearhead(?:ed)?)\b/gi, hint: '유행어 대신 사용한 기술과 맡은 일을 쓰세요.' },
  { kind: 'typography', pattern: /[—–]|!+|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, hint: '이력서 문장에는 줄표·느낌표·이모지를 쓰지 않습니다.' },
];

const squash = (text: string) => text.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

// text에서 문제 표현을 찾되, allowedSources(사용자 원문)에 같은 표현이 있으면 제외한다.
export function findSlop(text: string, allowedSources: string[] = []): SlopIssue[] {
  const allowed = squash(allowedSources.join('\n'));
  const seen = new Set<string>();
  const issues: SlopIssue[] = [];
  const normalized = text.normalize('NFKC');
  for (const rule of RULES) {
    for (const match of normalized.matchAll(rule.pattern)) {
      const phrase = match[0];
      const key = squash(phrase);
      if (!key || seen.has(key) || allowed.includes(key)) continue;
      seen.add(key);
      issues.push({ kind: rule.kind, phrase: phrase.trim() || phrase, hint: rule.hint });
    }
  }
  return issues;
}

// live 대화 모델에 주는 작성 규칙. 검사 규칙과 같은 내용을 사람이 읽는 문장으로 둔다.
export const SLOP_GUIDANCE = [
  '다짐·성향 문구(열정, 끊임없이, 최선을 다해, 도전 정신, 소통 능력, 성장하는 개발자 등)를 쓰지 않는다.',
  '근거 없는 평가어(탁월한, 뛰어난, 혁신적, 성공적으로, 극대화, 핵심적인 역할, 시너지, 임팩트, 오너십 등)를 쓰지 않는다.',
  "연결 장치('뿐만 아니라', '나아가', '이를 통해', '단순히 ~가 아닌')로 문장을 늘리지 않는다. 한 문장에 한 가지 사실만 쓴다.",
  '줄표(—), 느낌표, 이모지, 영어 유행어(synergy, leverage, passionate, robust 등)를 쓰지 않는다.',
  '확정 사실의 표현을 최대한 그대로 쓰고, 동사로 끝나는 짧은 문장(~했습니다/~을 담당)으로 쓴다.',
] as const;
