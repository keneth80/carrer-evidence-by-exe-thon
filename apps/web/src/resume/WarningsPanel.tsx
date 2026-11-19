import { parseWarning } from '../../../../packages/resume/src/types.ts';
import type { ExtractionWarning, WarningCode } from '../../../../packages/resume/src/types.ts';
import { quoteAt } from './SourcePanel.tsx';
import type { Span } from './SourcePanel.tsx';
import type { SourceText } from './api.ts';
import type { SourceLine } from './bulk.ts';

// 사실 후보로 만들지 않은 줄. 연락처·희망 조건·미확인 표현을 경력과 섞지 않고 따로 보여준다.
const groups: { title: string; note: string; codes: WarningCode[]; addable: boolean }[] = [
  { title: '연락처', note: '경력 사실과 검색 질의에 쓰지 않습니다.', codes: ['PERSONAL_INFO_EXCLUDED'], addable: false },
  { title: '희망 조건 후보 (사실 아님)', note: '희망 직무·지역·연봉은 다음 단계의 검색 조건에서 따로 입력합니다.', codes: ['PREFERENCE_NOT_FACT'], addable: false },
  { title: '추가 확인 필요', note: '부정·미확인 표현이거나 분류하지 못한 줄입니다. 자동으로 경력에 넣지 않았습니다. 본인 경력이 맞으면 직접 추가하세요.', codes: ['NEGATED_OR_UNVERIFIED', 'UNCLASSIFIED_LINE'], addable: true },
];

type Props = { warnings: string[]; source: SourceText | null; readOnly: boolean; onShow: (span: Span) => void; onAdd: (span: Span, quote: string) => void; onAddMany: (lines: SourceLine[]) => void };

export function WarningsPanel({ warnings, source, readOnly, onShow, onAdd, onAddMany }: Props) {
  const parsed = warnings.map(parseWarning).filter((item): item is ExtractionWarning => item !== null);
  const located = parsed.filter(item => item.start !== null && item.end !== null);
  return <div className="warning-groups">
    {groups.map(group => {
      const entries = located.filter(item => group.codes.includes(item.code));
      if (entries.length === 0) return null;
      const lines: SourceLine[] = entries.map(item => {
        const span = { page: item.page, start: item.start as number, end: item.end as number };
        return { span, quote: quoteAt(source, span) ?? '' };
      });
      return <section key={group.title} className="warning-group">
        <h3>{group.title} <span className="count">{entries.length}</span>
          {/* 본인 경력이 맞는 줄이 많을 때 한꺼번에 추가한다. 이미 추가한 줄은 다시 넣지 않고, 추가 후 분류별로 제외할 수 있다. */}
          {group.addable && !readOnly && <button type="button" className="ghost" onClick={() => onAddMany(lines)}>이 묶음 모두 추가</button>}
        </h3>
        <p className="fine-print">{group.note}</p>
        <ul>
          {entries.map(item => {
            const span = { page: item.page, start: item.start as number, end: item.end as number };
            const quote = quoteAt(source, span) ?? '';
            return <li key={`${item.page}-${item.start}`}>
              <span>{quote}</span>
              <span className="row-actions">
                <button type="button" className="ghost" onClick={() => onShow(span)}>원문 보기</button>
                {group.addable && !readOnly && quote && <button type="button" className="ghost" onClick={() => onAdd(span, quote)}>+ 경력으로 추가</button>}
              </span>
            </li>;
          })}
        </ul>
      </section>;
    })}
  </div>;
}
