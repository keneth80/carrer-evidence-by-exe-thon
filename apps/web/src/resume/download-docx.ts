import { DOCX_FILENAME, resumeDocx, TAILORED_DOCX_FILENAME, tailoredDocx } from '../../../../packages/render/src/resume-docx.ts';
import type { FactLike, ResumeBlock } from '../../../../packages/tailor/src/types.ts';
import type { FactRevision } from './api.ts';

// 기본 이력서 Word 내려받기(DECISIONS S1-23). 이 브라우저에서 확정 경력으로 파일을 만들어 저장한다(서버 전송·저장 없음).
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function downloadResumeDocx(revision: FactRevision): void {
  saveDocx(resumeDocx(revision.facts), DOCX_FILENAME(revision.revision));
}

// 공고별 이력서 Word: 지금 보고 있는 버전의 블록을 미리보기와 같은 회사별 배치로 저장한다(서버 전송·저장 없음).
export function downloadTailoredDocx(blocks: ResumeBlock[], facts: FactLike[], company: string, revision: number): void {
  saveDocx(tailoredDocx(blocks, facts), TAILORED_DOCX_FILENAME(company, revision));
}

function saveDocx(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: DOCX_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // 내려받기가 시작된 뒤 주소를 정리한다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
