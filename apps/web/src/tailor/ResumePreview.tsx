import type { ReactNode } from 'react';
import { resumeLayout } from '../../../../packages/tailor/src/layout.ts';
import type { CareerItem } from '../../../../packages/tailor/src/layout.ts';
import { sectionLabel } from '../../../../packages/tailor/src/types.ts';
import type { ResumeBlock } from '../../../../packages/tailor/src/types.ts';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';

// 공고별 이력서 미리보기. PDF와 같은 배치(layout.ts: 회사 아래에 직무·업무·성과)를 쓴다. 강조: 공고 요구와 연결된 블록, 방금 바뀐 블록.

// facts: 근거 문장 표시용(세션 버전 + 최신 버전). order: 회사 묶음 기준(세션의 확정 경력 버전, PDF와 같은 기준). 없으면 facts.
type Props = { blocks: ResumeBlock[]; facts: ResumeFact[]; order?: ResumeFact[]; highlightFacts?: Set<string>; changedIds?: Set<string> };

export function ResumePreview({ blocks, facts, order, highlightFacts, changedIds }: Props) {
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  const mark = (block: ResumeBlock) => `${highlightFacts && block.fact_ids.some(id => highlightFacts.has(id)) ? 'linked' : ''} ${changedIds?.has(block.id) ? 'changed' : ''}`;
  const evidence = (block: ResumeBlock) => `근거: ${block.fact_ids.map(id => byId.get(id)?.statement ?? id).join(' / ')}`;
  const edited = (block: ResumeBlock | null) => block && changedIds?.has(block.id) ? <span className="tag edited">바뀜</span> : null;
  const line = (block: ResumeBlock, extra?: ReactNode) => <li key={block.id} className={mark(block)} title={evidence(block)}>{extra}{block.text}{edited(block)}</li>;
  const subline = (item: CareerItem) => item.kind === 'role' || item.kind === 'period';

  return <div className="resume-preview">
    {resumeLayout(blocks, order ?? facts).map(group => <section key={group.section}>
      <h3>{sectionLabel(group.section)}</h3>
      {group.blocks.length > 0 && <ul>{group.blocks.map(block => line(block))}</ul>}
      {group.employers.map((employer, index) => <div key={employer.heading?.id ?? `employer-${index}`} className="employer">
        <h4 className={employer.heading ? mark(employer.heading) : ''} title={employer.heading ? evidence(employer.heading) : undefined}>{employer.title}{edited(employer.heading)}</h4>
        {employer.items.filter(subline).map(item => <p key={item.block.id} className={`employer-role ${mark(item.block)}`} title={evidence(item.block)}>{item.block.text}{edited(item.block)}</p>)}
        {employer.items.some(item => !subline(item)) && <ul>{employer.items.filter(item => !subline(item)).map(item =>
          line(item.block, item.kind === 'achievement' ? <span className="tag result">성과</span> : null))}</ul>}
      </div>)}
    </section>)}
  </div>;
}

// 부모 revision과 비교해 새로 생기거나 문장이 바뀐 블록 ID.
export function changedBlockIds(current: ResumeBlock[], parent: ResumeBlock[] | undefined): Set<string> {
  if (!parent) return new Set();
  const before = new Map(parent.map(block => [block.id, block.text]));
  return new Set(current.filter(block => before.get(block.id) !== block.text).map(block => block.id));
}
