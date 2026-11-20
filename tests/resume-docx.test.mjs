import { test } from 'node:test';
import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { resumeDocx, resumeDocxLines, DOCX_FILENAME } from '../packages/render/src/resume-docx.ts';
import { storeZip, crc32 } from '../packages/render/src/zip.ts';

// 사용자 요청(2026-11-20): 보완한 기본 이력서(확정 경력 최신 버전)를 Word(.docx)로 내려받아 이름·연락처를 직접 넣는다.
// 브라우저에서 만든다(서버 전송·저장 없음). 확정 경력 문장은 그대로 쓰고 새 내용을 만들지 않는다. 합성 경력만 쓴다.

const fact = (id, category, statement) => ({ id, category, statement });
const FACTS = [
  fact('o1', 'other', '결제·정산 화면을 만들어 온 프론트엔드 개발자입니다.'),
  fact('e1', 'employer', '예시페이'), fact('p1', 'period', '2021.03 ~ 재직 중'), fact('r1', 'role', '프론트엔드 개발자'),
  fact('d1', 'responsibility', '정산 화면을 React로 개발했습니다.'),
  fact('a1', 'achievement', '배포 시간을 30분에서 5분으로 줄였습니다.'),
  fact('e2', 'employer', '예시커머스 & <파트너스>'), fact('p2', 'period', '2018.01 ~ 2021.02'),
  fact('d2', 'responsibility', '주문 화면을 개발했습니다.'),
  fact('s1', 'skill', 'React'), fact('s2', 'skill', 'TypeScript'),
  fact('u1', 'education', '예시대학교 컴퓨터공학과 졸업'),
  fact('c1', 'certification', '정보처리기사'),
];

test('CRC-32는 표준 값과 같다', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('저장 방식 zip은 표준 도구로 다시 읽힌다(이름·내용 그대로)', async () => {
  const bytes = storeZip([{ name: 'a.txt', data: new TextEncoder().encode('가나다') }, { name: 'dir/b.xml', data: new TextEncoder().encode('<x/>') }]);
  const zip = await JSZip.loadAsync(bytes);
  assert.deepEqual(Object.keys(zip.files).sort(), ['a.txt', 'dir/b.xml']);
  assert.equal(await zip.file('a.txt').async('string'), '가나다');
});

test('문단 구성: 맨 위 [이름]·[연락처] 빈칸, 원래 순서대로 구역 제목·회사(기간)·직무·업무 글머리, 기술은 한 줄', () => {
  const lines = resumeDocxLines(FACTS);
  assert.deepEqual(lines.slice(0, 2).map(line => [line.style, line.text]), [['Title', '[이름]'], ['Contact', '[이메일] · [전화번호]']]);
  const flat = lines.map(line => `${line.style}:${line.text}`);
  assert.deepEqual(flat.slice(2), [
    'Heading1:요약', 'Body:결제·정산 화면을 만들어 온 프론트엔드 개발자입니다.',
    'Heading1:경력', 'Heading2:예시페이 · 2021.03 ~ 재직 중', 'Role:프론트엔드 개발자',
    'Bullet:정산 화면을 React로 개발했습니다.', 'Bullet:배포 시간을 30분에서 5분으로 줄였습니다.',
    'Heading2:예시커머스 & <파트너스> · 2018.01 ~ 2021.02', 'Bullet:주문 화면을 개발했습니다.',
    'Heading1:기술', 'Body:React · TypeScript',
    'Heading1:학력', 'Body:예시대학교 컴퓨터공학과 졸업',
    'Heading1:자격', 'Body:정보처리기사',
  ]);
});

test('Word 파일: mammoth(실제 업로드 경로와 같은 라이브러리)로 열리고, 확정 경력 문장이 그대로 들어 있다. 특수문자는 깨지지 않는다', async () => {
  const bytes = resumeDocx(FACTS);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  for (const item of FACTS) assert.ok(value.includes(item.statement), item.statement);
  assert.ok(value.includes('[이름]') && value.includes('[이메일] · [전화번호]'));
  const html = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;
  assert.match(html, /<h1>경력<\/h1>/, 'heading styles are real Word headings');
});

test('같은 입력이면 같은 bytes(날짜 고정), 제어 문자는 빼고 줄바꿈은 유지, 빈 경력도 파일은 만든다', async () => {
  assert.deepEqual(resumeDocx(FACTS), resumeDocx(FACTS));
  const odd = resumeDocx([fact('x', 'responsibility', '첫 줄\n둘째 줄\u0007')]);
  // extractRawText는 문단 안 줄바꿈(<w:br/>)을 버리므로 HTML 변환으로 확인한다.
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(odd) });
  assert.match(value, /첫 줄<br \/>둘째 줄/);
  assert.doesNotMatch(value, /\u0007/);
  const empty = await mammoth.extractRawText({ buffer: Buffer.from(resumeDocx([])) });
  assert.match(empty.value, /\[이름\]/);
});

test('회사 바로 뒤가 아니어도 같은 회사 구간의 첫 기간을 회사 제목에 붙인다(실제 이력서: 회사 → 직함 → 기간 순서)', () => {
  const lines = resumeDocxLines([
    fact('e1', 'employer', '예시회사'), fact('r1', 'role', '플랫폼팀 | 프론트엔드 개발'), fact('p1', 'period', '2020.01 ~ 2022.12'),
    fact('d1', 'responsibility', '정산 화면을 개발했습니다.'), fact('p2', 'period', '2023.01 ~ 재직 중'),
    fact('e2', 'employer', '예시상사'), fact('d2', 'responsibility', '주문 화면을 개발했습니다.'), fact('p3', 'period', '2018.01 ~ 2019.12'),
  ]).map(line => `${line.style}:${line.text}`);
  assert.deepEqual(lines.slice(2), [
    'Heading1:경력', 'Heading2:예시회사 · 2020.01 ~ 2022.12', 'Role:플랫폼팀 | 프론트엔드 개발', 'Bullet:정산 화면을 개발했습니다.', 'Role:2023.01 ~ 재직 중',
    'Heading2:예시상사 · 2018.01 ~ 2019.12', 'Bullet:주문 화면을 개발했습니다.',
  ]);
});

test('파일 이름은 버전 번호를 붙인다', () => {
  assert.equal(DOCX_FILENAME(7), '기본이력서_v7.docx');
});
