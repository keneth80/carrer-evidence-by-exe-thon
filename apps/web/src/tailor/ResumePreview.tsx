import { groupBySection } from '../../../../packages/tailor/src/blocks.ts';
import { sectionLabel } from '../../../../packages/tailor/src/types.ts';
import type { ResumeBlock } from '../../../../packages/tailor/src/types.ts';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';

// 공고별 이력서 미리보기. PDF와 같은 구역 순서·이름을 쓴다. 강조: 공고 요구와 연결된 블록, 방금 바뀐 블록.

export function ResumePreview({ blocks, facts, highlightFacts, changedIds }: { blocks: ResumeBlock[]; facts: ResumeFact[]; highlightFacts?: Set<string>; changedIds?: Set<string> }) {
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  return <div className="resume-preview">
    {groupBySection(blocks).map(group => <section key={group.section}>
      <h3>{sectionLabel(group.section)}</h3>
      <ul>{group.blocks.map(block => {
        const linked = highlightFacts && block.fact_ids.some(id => highlightFacts.has(id));
        const evidence = block.fact_ids.map(id => byId.get(id)?.statement ?? id).join(' / ');
        return <li key={block.id} className={`${linked ? 'linked' : ''} ${changedIds?.has(block.id) ? 'changed' : ''}`} title={`근거: ${evidence}`}>
          {block.text}
          {changedIds?.has(block.id) && <span className="tag edited">바뀜</span>}
        </li>;
      })}</ul>
    </section>)}
  </div>;
}

// 부모 revision과 비교해 새로 생기거나 문장이 바뀐 블록 ID.
export function changedBlockIds(current: ResumeBlock[], parent: ResumeBlock[] | undefined): Set<string> {
  if (!parent) return new Set();
  const before = new Map(parent.map(block => [block.id, block.text]));
  return new Set(current.filter(block => before.get(block.id) !== block.text).map(block => block.id));
}
