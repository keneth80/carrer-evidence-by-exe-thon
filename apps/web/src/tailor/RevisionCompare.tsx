import { useState } from 'react';
import { sectionLabel } from '../../../../packages/tailor/src/types.ts';
import type { EditProposal, JobSnapshot, ResumeRevision } from '../resume/api.ts';
import { compareRevisions, compareSummary, wordDiff } from './compare.ts';
import type { CompareRow, Segment } from './compare.ts';

// 공고 맞춤 수정 전후 비교(DECISIONS S4-17). 어떤 공고로 고쳤는지와, 처음 버전 대비 바뀐 줄·이유를 한 화면에 보인다.

type Props = { base: ResumeRevision; current: ResumeRevision; proposals: EditProposal[]; job: JobSnapshot };

const KIND_LABEL: Record<Exclude<CompareRow['kind'], 'same'>, string> = { added: '추가', changed: '바뀜', removed: '삭제', moved: '순서' };

const segments = (items: Segment[], tag: 'ins' | 'del') => items.map((item, index) => item.changed
  ? (tag === 'ins' ? <ins key={index}>{item.text}</ins> : <del key={index}>{item.text}</del>)
  : <span key={index}>{item.text}</span>);

function Row({ row }: { row: CompareRow }) {
  if (row.kind === 'same') return <li className="cmp-row same">{row.after}</li>;
  const diff = row.kind === 'changed' ? wordDiff(row.before ?? '', row.after ?? '') : null;
  return <li className={`cmp-row ${row.kind}`}>
    <span className={`tag cmp-${row.kind}`}>{KIND_LABEL[row.kind]}</span>
    {diff ? <div className="cmp-pair">
      <p className="cmp-before"><span className="cmp-side">전</span>{segments(diff.before, 'del')}</p>
      <p className="cmp-after"><span className="cmp-side">후</span>{segments(diff.after, 'ins')}</p>
    </div> : <p className={row.kind === 'removed' ? 'cmp-before' : 'cmp-after'}>{row.kind === 'removed' ? <del>{row.before}</del> : row.after}</p>}
    {row.reason && <p className="cmp-reason">이유: {row.reason}</p>}
  </li>;
}

export function RevisionCompare({ base, current, proposals, job }: Props) {
  const [onlyChanged, setOnlyChanged] = useState(true);
  const rows = compareRevisions(base.blocks, current.blocks, proposals);
  const counts = compareSummary(rows);
  const visible = onlyChanged ? rows.filter(row => row.kind !== 'same') : rows;
  // 연속한 같은 구역 줄을 하나의 묶음으로 보인다.
  const groups = visible.reduce<{ section: string; rows: CompareRow[] }[]>((acc, row) => {
    const last = acc.at(-1);
    return last && last.section === row.section ? [...acc.slice(0, -1), { ...last, rows: [...last.rows, row] }] : [...acc, { section: row.section, rows: [row] }];
  }, []);

  return <div className="revision-compare">
    <div className="cmp-job">
      <span className="muted">이 공고에 맞춰 수정</span>
      <strong>{job.company_name} · {job.title}</strong>
      {job.data_origin === 'synthetic' && <span className="pill">합성 공고</span>}
    </div>
    <p className="muted cmp-versions">수정 전: {base.revision}번째 버전(확정 경력으로 만든 기본 이력서) → 수정 후: 지금 {current.revision}번째 버전</p>
    <div className="cmp-counts" aria-label="바뀐 줄 수">
      <span>추가 {counts.added}</span><span>바뀜 {counts.changed}</span><span>순서 {counts.moved}</span><span>삭제 {counts.removed}</span><span className="muted">그대로 {counts.same}</span>
    </div>
    <label className="check cmp-toggle"><input type="checkbox" checked={onlyChanged} onChange={event => setOnlyChanged(event.target.checked)} /> 바뀐 줄만 보기</label>
    {visible.length === 0 ? <p className="muted">처음 버전과 달라진 줄이 없습니다.</p> : groups.map((group, index) => <section key={`${group.section}-${index}`}>
      <h3>{sectionLabel(group.section)}</h3>
      <ul>{group.rows.map(row => <Row key={`${row.kind}-${row.block_id}`} row={row} />)}</ul>
    </section>)}
  </div>;
}
