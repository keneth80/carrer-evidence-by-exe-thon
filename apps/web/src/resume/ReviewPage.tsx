import { useCallback, useEffect, useRef, useState } from 'react';
import type { FactReview, ResumeFact } from '../../../../packages/resume/src/types.ts';
import { api, ApiError, describeError } from './api.ts';
import type { DocumentSummary, ExtractionDraft, FactRevision, SourceText } from './api.ts';
import { FactEditor, isWithinEvidence } from './FactEditor.tsx';
import type { EditableFact } from './FactEditor.tsx';
import { SourcePanel } from './SourcePanel.tsx';
import type { Span } from './SourcePanel.tsx';
import { WarningsPanel } from './WarningsPanel.tsx';
import { FactBulkBar } from './FactBulkBar.tsx';
import { ExtractionProgress } from './ExtractionProgress.tsx';
import { addLines } from './bulk.ts';
import { attentionLabel, attentionSummary } from './attention.ts';
import type { AttentionSummary } from './attention.ts';
import { SupplementSection } from './SupplementSection.tsx';
import { downloadResumeDocx } from './download-docx.ts';
import type { SourceLine } from './bulk.ts';
import { navigate } from '../router.ts';
import { recentSearch } from '../search/recent.ts';

// U02 추출 내용 확인. 확인 전 초안은 확정 경력이 아니며, 저장하면 새 경력 revision을 만든다.

type Loaded = { summary: DocumentSummary; draft: ExtractionDraft | null; source: SourceText | null; revision: FactRevision | null; review?: Record<string, FactReview> };

const failureHelp: Record<string, string> = {
  EMPTY_TEXT: '텍스트를 읽지 못했어요. 내용을 텍스트로 붙여넣거나 다른 파일을 올려 주세요.',
  OCR_NO_TEXT: '스캔본(그림으로 된 PDF)으로 보이지만 글자를 인식하지 못했어요. 더 선명하게 스캔한 파일을 올리거나 내용을 텍스트로 붙여넣어 주세요.',
  OCR_TIMEOUT: '스캔본의 글자를 인식하는 데 시간이 너무 오래 걸렸어요. 쪽 수를 줄여 올리거나 내용을 텍스트로 붙여넣어 주세요.',
  PDF_ENCRYPTED: '암호가 걸린 PDF입니다. 암호를 해제한 PDF를 올리거나 내용을 붙여넣어 주세요.',
  PDF_INVALID: 'PDF 구조를 읽을 수 없습니다. 다시 저장한 PDF를 올리거나 내용을 붙여넣어 주세요.',
  PDF_PARSE_FAILED: 'PDF를 여는 중 오류가 났습니다. 다른 PDF를 올리거나 내용을 붙여넣어 주세요.',
  PDF_TOO_MANY_PAGES: '30쪽을 넘는 PDF는 읽지 않습니다. 필요한 부분을 붙여넣어 주세요.',
};

// 확인할 것만 맨 위에 모아 알린다(S1-37). 원문 그대로인 묶음은 접혀 있으니 제목만 훑고 저장해도 된다.
function AttentionNotice({ summary }: { summary: AttentionSummary }) {
  const parts = [
    ...(['not_in_source', 'sensitive_excluded', 'user_added'] as const).filter(reason => summary[reason] > 0).map(reason => `${attentionLabel[reason]} ${summary[reason]}`),
    ...(summary.source_lines > 0 ? [`경력에 넣지 않은 원문 줄 ${summary.source_lines}(맨 아래 ‘추가 확인 필요’)`] : []),
  ];
  return <div className="notice attention-summary" role="status">
    <strong>{summary.total > 0 ? `확인할 것 ${summary.total}개` : '확인할 것 없음'}</strong>
    <span>{parts.length > 0 ? `${parts.join(' · ')}. ` : ''}나머지는 원문 문장 그대로라 묶음을 접어 두었습니다. 묶음 제목을 훑어보고, 고칠 곳만 펼쳐서 수정하세요.</span>
  </div>;
}

async function load(documentId: string): Promise<Loaded | 'not_found'> {
  const summary = (await api.documents()).items.find(item => item.document.id === documentId);
  if (!summary) return 'not_found';
  const status = summary.document.extraction_status;
  if (status === 'uploaded' || status === 'extracting') return { summary, draft: null, source: null, revision: null };
  const draft = await api.extraction(documentId);
  const source = await api.sourceText(documentId).catch((error: unknown) => { if (error instanceof ApiError && error.status === 409) return null; throw error; });
  const revision = summary.current_fact_revision_id ? await api.factRevision(summary.current_fact_revision_id) : null;
  const review = summary.latest_task ? await api.extractionReview(summary.latest_task.id) : undefined;
  return { summary, draft, source, revision, review };
}

function editable(facts: ResumeFact[], origin: EditableFact['origin']): EditableFact[] {
  return facts.map(fact => ({ fact, original: fact.statement, included: true, origin }));
}

export function ReviewPage({ documentId }: { documentId: string }) {
  const [data, setData] = useState<Loaded | 'not_found' | null>(null);
  const [items, setItems] = useState<EditableFact[]>([]);
  const [editing, setEditing] = useState(false);
  const [highlight, setHighlight] = useState<Span | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveKey, setSaveKey] = useState(() => crypto.randomUUID());

  const [failures, setFailures] = useState(0);
  const latest = useRef(0);

  const refresh = useCallback(() => {
    // 늦게 도착한 이전 응답이 최신 화면을 덮지 않도록 마지막 요청만 반영한다.
    const ticket = ++latest.current;
    load(documentId).then(value => {
      if (ticket !== latest.current) return;
      setError(null); setFailures(0);
      setData(value);
      if (value !== 'not_found' && value.draft) {
        setItems(value.revision ? editable(value.revision.facts, 'confirmed') : editable(value.draft.facts, 'extracted').map(item =>
          value.review?.[item.fact.id]?.section === 'sensitive' ? { ...item, included: false } : item));
        setEditing(!value.revision);
      }
    }).catch(failure => {
      if (ticket !== latest.current) return;
      if (failure instanceof ApiError && failure.status === 401) { window.location.assign('/start'); return; }
      setError(describeError(failure));
      setFailures(count => count + 1);
    });
  }, [documentId]);

  useEffect(() => { refresh(); }, [refresh]);
  const status = data && data !== 'not_found' ? data.summary.document.extraction_status : null;
  const polling = status === 'uploaded' || status === 'extracting' || (data === null && failures > 0);
  useEffect(() => {
    if (!polling || failures > 5) return;
    const timer = window.setTimeout(refresh, failures > 0 ? 1200 * 2 ** failures : 1200);
    return () => window.clearTimeout(timer);
  }, [polling, data, failures, refresh]);

  if (error && !data) return <div role="alert" className="error">{error}</div>;
  if (!data) return <p role="status" className="status-line">문서를 불러오는 중…</p>;
  if (data === 'not_found') return <div role="alert" className="error">이 문서를 찾을 수 없습니다. 다른 사용자로 연결했거나 없는 문서입니다. <a href="/start">이력서 등록으로</a></div>;

  const { summary, draft, source, revision } = data;
  const document = summary.document;
  const readOnly = !editing;
  // 같은 원문 위치는 한 번만 추가한다. 여러 줄을 한꺼번에 넣어도 id가 겹치지 않게 bulk.addLines를 쓴다.
  const addLinesFromSource = (lines: SourceLine[]) => {
    const prefix = `u${Date.now().toString(36)}`;
    setItems(current => addLines(current, lines, document.id, prefix));
    if (lines[0]) setHighlight(lines[0].span);
  };
  const addFromSource = (span: Span, quote: string) => addLinesFromSource([{ span, quote }]);

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const facts = items.filter(item => item.included).map(item => item.fact);
      await api.confirm(document.id, { extraction_id: draft.id, expected_parent_revision_id: summary.current_fact_revision_id, facts }, saveKey);
      setSaveKey(crypto.randomUUID());
      refresh();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.problem.code === 'FACT_REVISION_CONFLICT' ? '다른 화면에서 먼저 저장했습니다. 최신 내용을 다시 불러온 뒤 확인하세요.' : describeError(failure));
      setSaveKey(crypto.randomUUID());
    } finally { setSaving(false); }
  };

  const scanNote = draft?.warnings.find(warning => warning.startsWith('OCR_TEXT@- '))?.slice('OCR_TEXT@- '.length) ?? null;
  const includedCount = items.filter(item => item.included).length;
  const invalidCount = items.filter(item => item.included && !isWithinEvidence(item)).length;
  const linerTransmission = summary.latest_task?.provider_transmission;
  const showSourceGrouping = !revision && items.length > 0 && (linerTransmission === 'completed' || linerTransmission === 'unknown')
    && !Object.values(data.review ?? {}).some(annotation => annotation.primary);
  return <>
    <a className="back" href="/start" onClick={event => { event.preventDefault(); navigate('/start'); }}>← 이력서 등록으로</a>
    <section className="hero compact">
      <span className="eyebrow">U02 · 추출 내용 확인</span>
      <h1>{document.filename}</h1>
      <p>{document.input_kind === 'text_pdf' ? 'PDF' : document.input_kind === 'docx' ? 'Word(.docx)' : '붙여넣은 텍스트'} · 등록 {new Date(document.created_at).toLocaleString('ko-KR')} · <a href={`/api/v1/resume-documents/${document.id}/original`} target="_blank" rel="noreferrer">원본 열기</a></p>
    </section>
    {document.data_origin === 'synthetic' && <div className="notice"><strong>합성 예시</strong><span>저장소의 가상 이력서와 같은 파일입니다. 실제 인물·경력이 아닙니다.</span></div>}
    {(status === 'uploaded' || status === 'extracting') && <ExtractionProgress task={summary.latest_task} since={document.created_at} />}
    {/* 후보 0건은 읽기 실패가 아니다. 원문이 있으면 직접 골라 저장할 수 있으므로 오류 대신 안내로 보여준다. */}
    {status === 'failed' && document.error_code === 'NO_FACT_CANDIDATES' && source
      ? <div className="notice"><strong>자동 후보 0건</strong><span>원문은 읽었지만 경력 항목으로 자동 분류한 줄이 없습니다. 왼쪽 원문에서 줄마다 있는 ‘+ 추가’로 항목을 고른 뒤 저장하세요.</span></div>
      : status === 'failed' && <div role="alert" className="error">{failureHelp[document.error_code ?? ''] ?? '읽기에 실패했습니다. 내용을 붙여넣어 주세요.'} <a href="/start#paste">텍스트로 붙여넣기</a></div>}
    {revision && <div className="confirmed-banner" role="status">
      <strong>확정 경력 {revision.revision}번째 버전</strong>
      <span>{new Date(revision.confirmed_at).toLocaleString('ko-KR')} 저장 · 항목 {revision.facts.length}개</span>
      {!editing && <button className="outline small" onClick={() => setEditing(true)}>다시 확인·수정</button>}
      {/* 보완을 마친 기본 이력서를 Word로 받아 이름·연락처를 직접 넣는다(S1-23). 공고 맞춤 수정은 들어가지 않는다. */}
      {!editing && <button className="outline small" title="이름·연락처는 맨 위 [ ] 칸에 Word에서 직접 넣어 주세요. 이 브라우저에서 만들며 서버로 보내지 않아요." onClick={() => downloadResumeDocx(revision)}>기본 이력서 Word로 내려받기</button>}
    </div>}
    {/* 확정 경력이 있고 수정 중이 아닐 때 에이전트 점검·보완을 맨 앞에 보여 준다(S1-16). */}
    {revision && !editing && draft && <SupplementSection documentId={document.id} extractionId={draft.id} head={revision} onConfirmed={refresh} />}
    {/* 스캔본 경고(S1-35): 글자 인식 결과라 빠지거나 틀린 글자가 있을 수 있음을 눈에 띄게 알린다. 서버가 남긴 경고 문구(쪽 수 포함)를 그대로 보여 준다. */}
    {scanNote && <div role="alert" className="notice scan-warning"><strong>⚠ 스캔본 PDF입니다 · 글자 인식 결과</strong><span>{scanNote} 원본과 꼭 대조해 주세요. 잘못 읽힌 항목은 빼고 저장한 뒤 HR 전문가 점검에서 직접 쓴 문장으로 보완하거나, 정확한 내용을 텍스트로 붙여넣어 등록해 주세요(이 화면에서는 읽은 글에 없는 표현으로 고쳐 저장할 수 없어요).</span></div>}
    {/* AI 정리가 돌지 않았으면(mock·한도 초과·호출 실패) 조용히 규칙 결과만 보이지 않게 알린다. 작업의 실제 전송 상태로 판단한다. */}
    {!revision && draft?.status === 'review_required' && summary.latest_task?.kind === 'extract_resume' && summary.latest_task.provider_transmission !== 'completed'
      && <div className="notice"><strong>AI 정리 없이 읽은 결과</strong><span>{summary.latest_task.provider_transmission === 'unknown' ? 'AI 정리 호출이 실패했거나 응답을 확인하지 못해' : 'AI 정리가 꺼져 있거나 사용 한도에 걸려'} 규칙으로 줄을 나눈 결과만 보여 드립니다. 항목이 조각나 보일 수 있어요.</span></div>}
    {!revision && draft?.status === 'review_required' && <div className="notice"><strong>아직 확정 전</strong><span>아래 항목은 자동 추출 후보입니다. 확인하고 저장해야 확정 경력이 됩니다.</span></div>}
    {draft && <div className="review-grid">
      <section className="panel" aria-labelledby="source-title">
        <h2 id="source-title">원문</h2>
        <SourcePanel source={source} highlight={highlight} onAddLine={addFromSource} readOnly={readOnly} />
      </section>
      <section className="panel" aria-labelledby="facts-title">
        <h2 id="facts-title">{revision && !editing ? '확정 경력' : '경력 항목 확인'} <span className="count">{includedCount}</span></h2>
        {showSourceGrouping && <p className="notice"><span>Liner 검토 초안을 적용하지 못해 원문 기준으로 구역을 분류했습니다.</span></p>}
        {!readOnly && <AttentionNotice summary={attentionSummary(items, data.review, draft.warnings)} />}
        {!readOnly && <FactBulkBar items={items} onChange={setItems} />}
        <FactEditor inputKind={document.input_kind} source={source} items={items} review={data.review} readOnly={readOnly} onShow={setHighlight} onChange={(index, next) => setItems(current => current.map((item, i) => i === index ? next : item))}
          onToggleGroup={(indexes, included) => setItems(current => current.map((item, i) => indexes.includes(i) && item.included !== included ? { ...item, included } : item))} />
        <WarningsPanel warnings={draft.warnings} source={source} readOnly={readOnly} onShow={setHighlight} onAdd={addFromSource} onAddMany={addLinesFromSource} />
      </section>
    </div>}
    {error && <div role="alert" className="error">{error} {error.includes('다시 불러온') && <button className="outline small" onClick={refresh}>다시 불러오기</button>}</div>}
    {draft && <div className="action-bar">
      {editing && <button className="primary" disabled={saving || includedCount === 0 || invalidCount > 0 || !source} onClick={save}>{saving ? '저장 중…' : revision ? '수정한 내용으로 새 버전 저장' : '확인한 내용 저장'}</button>}
      {/* 확정 경력이 있고 수정 중이 아닐 때만 검색한다. 확인 전 초안은 검색 근거가 아니다. */}
      {recentSearch(document.id) && <a className="text-link" href={`/searches/${recentSearch(document.id)}`} onClick={event => { event.preventDefault(); navigate(`/searches/${recentSearch(document.id)}`); }}>최근 검색 결과 보기</a>}
      <button className="outline" disabled={!revision || editing} title={!revision ? '먼저 확인한 내용을 저장하세요' : editing ? '수정 중인 내용을 저장한 뒤 검색하세요' : undefined}
        onClick={() => navigate(`/resumes/${document.id}/search`)}>확인한 내용으로 공고 찾기</button>
    </div>}
  </>;
}
