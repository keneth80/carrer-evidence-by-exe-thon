import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges, baseBlocks } from '../packages/tailor/src/blocks.ts';
import { layoutTexts, resumeLayout } from '../packages/tailor/src/layout.ts';
import { renderResumePdf } from '../packages/render/src/resume-pdf.ts';

// 사용자 테스트(2026-11-21): 맞춤 이력서 미리보기에서 '경력'(회사)과 '경력 내용'·'성과'가 따로 나왔다.
// 회사 아래에 그 회사의 직무·기간·업무·성과를 묶는다. 합성 경력만 쓴다.

const fact = (id, category, statement) => ({ id, category, statement });
const FACTS = [
  fact('o1', 'other', '결제 서비스를 만들어 온 개발자입니다.'),
  fact('r0', 'role', '백엔드 개발자'),
  fact('e1', 'employer', '가나 주식회사'),
  fact('r1', 'role', '선임 개발자'),
  fact('p1', 'period', '2022.03 - 현재'),
  fact('w1', 'responsibility', '정산 API를 설계했습니다.'),
  fact('a1', 'achievement', '정산 시간을 하루에서 1시간으로 줄였습니다.'),
  fact('e2', 'employer', '다라 주식회사'),
  fact('p2', 'period', '2019.01 - 2022.02'),
  fact('w2', 'responsibility', '주문 화면을 개발했습니다.'),
  fact('a2', 'achievement', '배포 절차를 문서로 정리했습니다.'),
  fact('s1', 'skill', 'TypeScript'),
  fact('s2', 'skill', 'PostgreSQL'),
  fact('d1', 'education', '가나대학교 컴퓨터공학과'),
  fact('c1', 'certification', '정보처리기사'),
];

const employerView = sections => sections.find(section => section.section === '경력').employers
  .map(group => ({ title: group.title, items: group.items.map(item => `${item.kind}:${item.block.text}`) }));

test('회사 아래에 직무·업무·성과를 묶고, 떨어진 기간은 회사 제목에 붙인다', () => {
  const sections = resumeLayout(baseBlocks(FACTS), FACTS);
  assert.deepEqual(sections.map(section => section.section), ['요약', '직무', '기술', '경력', '학력', '자격']);
  assert.deepEqual(employerView(sections), [
    { title: '가나 주식회사 · 2022.03 - 현재', items: ['role:선임 개발자', 'work:정산 API를 설계했습니다.', 'achievement:정산 시간을 하루에서 1시간으로 줄였습니다.'] },
    { title: '다라 주식회사 · 2019.01 - 2022.02', items: ['work:주문 화면을 개발했습니다.', 'achievement:배포 절차를 문서로 정리했습니다.'] },
  ]);
  assert.equal(sections.find(section => section.section === '경력').blocks.length, 0, 'no loose career blocks');
  assert.deepEqual(sections.find(section => section.section === '직무').blocks.map(block => block.text), ['백엔드 개발자'], 'role before any employer stays in summary sections');
});

test('맞춤 수정 뒤에도 고친 성과는 그 회사 아래에, 추가 요약은 핵심 요약에, 근거를 못 찾은 블록은 원래 구역에 둔다', () => {
  const blocks = baseBlocks(FACTS);
  const target = blocks.find(block => block.id === 'blk_a2');
  const applied = applyChanges(blocks, [
    { operation: 'replace', block_id: 'blk_a2', before: target.text, after: '배포 절차 문서를 만들어 팀 배포에 썼습니다.', fact_ids: ['a2'], reason: 'x', needs_fact_confirmation: false },
    { operation: 'insert', block_id: 'blk_new', before: null, after: '정산 API 설계 경험이 있는 백엔드 개발자입니다.', fact_ids: ['w1', 'r0'], reason: 'x', needs_fact_confirmation: false },
  ]);
  assert.ok(applied.ok);
  const withUnknown = [...applied.blocks, { id: 'blk_x', section: '성과', text: '근거를 찾을 수 없는 문장', fact_ids: ['zzz'] }];
  const sections = resumeLayout(withUnknown, FACTS);
  assert.equal(sections[0].section, '맞춤 요약');
  assert.deepEqual(sections[0].blocks.map(block => block.id), ['blk_new']);
  assert.deepEqual(employerView(sections)[1].items, ['work:주문 화면을 개발했습니다.', 'achievement:배포 절차 문서를 만들어 팀 배포에 썼습니다.']);
  assert.deepEqual(sections.find(section => section.section === '성과').blocks.map(block => block.id), ['blk_x']);
});

test('회사 블록이 지워져도 확정 경력의 회사 문장을 제목으로 쓰고, 사실이 없으면 구역별로만 나눈다', () => {
  const blocks = baseBlocks(FACTS).filter(block => block.id !== 'blk_e2');
  assert.equal(employerView(resumeLayout(blocks, FACTS))[1].title, '다라 주식회사');
  const plain = resumeLayout(baseBlocks(FACTS), []);
  assert.ok(plain.every(section => section.employers.length === 0));
  assert.ok(plain.some(section => section.section === '성과'));
});

test('PDF도 같은 회사별 배치로 그리고, 같은 입력이면 같은 bytes다', async () => {
  const at = new Date('2026-11-21T00:00:00Z');
  const blocks = baseBlocks(FACTS);
  const first = await renderResumePdf({ blocks, facts: FACTS, title: '이력서', finalizedAt: at });
  const second = await renderResumePdf({ blocks, facts: FACTS, title: '이력서', finalizedAt: at });
  assert.deepEqual(Buffer.from(first.bytes), Buffer.from(second.bytes));
  assert.match(first.renderVersion, /^resume-pdf\.v3/);
  assert.ok(layoutTexts(resumeLayout(blocks, FACTS)).includes('가나 주식회사 · 2022.03 - 현재'));
});

test('첫 회사 앞의 성과는 요약 다음 주요 성과로, 학력·자격 뒤 문장은 마지막 회사에 붙이지 않는다', () => {
  const facts = [FACTS[0], fact('k1', 'achievement', '결제 오류 대응 절차를 만들었습니다.'), ...FACTS.slice(1), fact('o9', 'other', '오픈소스 문서 번역에 참여했습니다.')];
  const sections = resumeLayout(baseBlocks(facts), facts);
  assert.deepEqual(sections.map(section => section.section), ['요약', '주요 성과', '직무', '기술', '경력', '학력', '자격']);
  assert.deepEqual(sections[1].blocks.map(block => block.text), ['결제 오류 대응 절차를 만들었습니다.']);
  assert.ok(!employerView(sections)[1].items.some(item => item.includes('오픈소스')), 'trailing text after certification stays out of the last employer');
  assert.ok(sections[0].blocks.some(block => block.text.includes('오픈소스')));
});

// 실제 이력서 테스트(2026-11-21): 최근 경력은 '회사 → 기간', 오래된 경력은 '기간 → 회사' 순서라 오래된 회사 6곳의 기간이 한 칸씩 밀렸고,
// 마지막 회사 뒤의 개인 프로젝트 15줄이 그 회사 밑에 붙었다.
test('기간이 회사 앞에 오는 경력도 제 회사에 붙이고, 마지막 회사 뒤 "이름 | 설명" 줄부터는 프로젝트로 묶는다', async () => {
  const { employerPeriods } = await import('../packages/tailor/src/layout.ts');
  const { resumeDocxLines } = await import('../packages/render/src/resume-docx.ts');
  const facts = [
    fact('e1', 'employer', '가나 주식회사'), fact('p1', 'period', '2022.03 - 현재'), fact('w1', 'responsibility', '정산 API를 설계했습니다.'),
    fact('p2', 'period', '2019.01 - 2022.02'), fact('e2', 'employer', '다라 주식회사'), fact('w2', 'responsibility', '주문 화면을 개발했습니다.'),
    fact('p3', 'period', '2016.01 - 2018.12'), fact('e3', 'employer', '마바 주식회사'), fact('w3', 'responsibility', '통계 화면을 개발했습니다.'),
    fact('j1', 'responsibility', '합성차트  |  오픈소스 제작'), fact('j2', 'responsibility', '차트 런타임을 설계했습니다.'),
    fact('j3', 'responsibility', '합성녹음기 | 모바일 앱 개발'), fact('j4', 'responsibility', '구간 선택 흐름을 설계했습니다.'),
    fact('d1', 'education', '가나대학교 졸업'),
  ];
  assert.deepEqual([...employerPeriods(facts)], [[0, 1], [4, 3], [7, 6]]);
  const sections = resumeLayout(baseBlocks(facts), facts);
  assert.deepEqual(sections.map(section => section.section), ['경력', '프로젝트', '학력']);
  assert.deepEqual(employerView(sections), [
    { title: '가나 주식회사 · 2022.03 - 현재', items: ['work:정산 API를 설계했습니다.'] },
    { title: '다라 주식회사 · 2019.01 - 2022.02', items: ['work:주문 화면을 개발했습니다.'] },
    { title: '마바 주식회사 · 2016.01 - 2018.12', items: ['work:통계 화면을 개발했습니다.'] },
  ]);
  assert.deepEqual(sections[1].employers.map(group => [group.title, group.items.map(item => item.block.text)]), [
    ['합성차트  |  오픈소스 제작', ['차트 런타임을 설계했습니다.']], ['합성녹음기 | 모바일 앱 개발', ['구간 선택 흐름을 설계했습니다.']],
  ]);
  const lines = resumeDocxLines(facts).map(line => `${line.style}:${line.text}`);
  assert.ok(lines.includes('Heading2:다라 주식회사 · 2019.01 - 2022.02') && lines.includes('Heading2:마바 주식회사 · 2016.01 - 2018.12'), 'base Word uses the same period rule');
  assert.deepEqual(lines.slice(lines.indexOf('Heading1:프로젝트')), ['Heading1:프로젝트', 'Heading2:합성차트  |  오픈소스 제작', 'Bullet:차트 런타임을 설계했습니다.', 'Heading2:합성녹음기 | 모바일 앱 개발', 'Bullet:구간 선택 흐름을 설계했습니다.', 'Heading1:학력', 'Body:가나대학교 졸업']);
  // 회사 → 직함 → 기간(구간 끝에 기간) 순서는 앞 회사의 기간을 다음 회사가 가져가지 않는다.
  const tail = [fact('e1', 'employer', '가'), fact('r1', 'role', '대리'), fact('p1', 'period', '2020 - 2022'), fact('e2', 'employer', '나'), fact('r2', 'role', '사원'), fact('p2', 'period', '2018 - 2020')];
  assert.deepEqual([...employerPeriods(tail)], [[0, 2], [3, 5]]);
});

test('프로젝트 구간의 소제목 줄은 새 묶음의 제목이 되고, 링크 안내 줄은 제목이 되지 않는다', async () => {
  const { projectSpan } = await import('../packages/tailor/src/layout.ts');
  const { resumeDocxLines } = await import('../packages/render/src/resume-docx.ts');
  const facts = [
    fact('e1', 'employer', '가나 주식회사'), fact('p1', 'period', '2022.03 - 현재'), fact('w1', 'responsibility', '정산 API를 설계했습니다.'),
    fact('j1', 'responsibility', '합성차트  |  오픈소스 제작'), fact('j2', 'responsibility', '차트 런타임을 설계했습니다.'), fact('j3', 'responsibility', 'example-chart.com'),
    fact('j4', 'responsibility', '합성녹음기 | 모바일 앱 개발'), fact('j5', 'responsibility', '구간 선택 흐름을 설계했습니다.'), fact('j6', 'responsibility', '스토어에서 보기'),
    fact('h1', 'responsibility', '협업과 프로젝트 운영'), fact('h2', 'responsibility', '출시 범위를 다시 합의했습니다.'), fact('h3', 'achievement', '버그 건수를 줄였습니다.'),
    fact('d1', 'education', '가나대학교 졸업'),
  ];
  assert.deepEqual(projectSpan(facts).heads, [3, 6, 9]);
  const groups = resumeLayout(baseBlocks(facts), facts).find(section => section.section === '프로젝트').employers;
  assert.deepEqual(groups.map(group => [group.title, group.items.map(item => item.block.text)]), [
    ['합성차트  |  오픈소스 제작', ['차트 런타임을 설계했습니다.', 'example-chart.com']],
    ['합성녹음기 | 모바일 앱 개발', ['구간 선택 흐름을 설계했습니다.', '스토어에서 보기']],
    ['협업과 프로젝트 운영', ['출시 범위를 다시 합의했습니다.', '버그 건수를 줄였습니다.']],
  ]);
  assert.ok(resumeDocxLines(facts).some(line => line.style === 'Heading2' && line.text === '협업과 프로젝트 운영'), 'base Word uses the same rule');
  // 회사 구간(프로젝트 제목 줄이 나오기 전)의 짧은 줄은 소제목으로 보지 않는다.
  const plain = [fact('e1', 'employer', '가'), fact('w0', 'responsibility', '프론트엔드 총괄'), fact('w1', 'responsibility', '화면을 개발했습니다.')];
  assert.equal(projectSpan(plain), null);
});
