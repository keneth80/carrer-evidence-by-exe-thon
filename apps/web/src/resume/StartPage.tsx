import { useEffect, useState } from 'react';
import { api, describeError } from './api.ts';
import type { DocumentSummary } from './api.ts';
import { navigate } from '../router.ts';

// U01 시작·이력서 등록. 서버 한도와 같은 값을 안내하고 실제 판정은 서버 응답을 따른다.
const MAX_PDF_MB = 5;
const INPUT_LABEL = { text_pdf: 'PDF', docx: 'Word', pasted_text: '붙여넣기' } as const;
const MAX_PASTE = 100_000;

const statusText: Record<string, string> = {
  uploaded: '등록됨 · 읽기 대기', extracting: '내용을 읽고 있어요', review_required: '확인 필요',
  extracted: '확정 경력 저장됨', failed: '읽기 실패 · 다른 방법 필요',
};

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function DocumentList({ items }: { items: DocumentSummary[] }) {
  if (items.length === 0) return <p className="muted">아직 등록한 이력서가 없습니다.</p>;
  return <ul className="doc-list">
    {items.map(({ document, current_fact_revision_id }) => <li key={document.id}>
      <a href={`/resumes/${document.id}/review`} onClick={event => { event.preventDefault(); navigate(`/resumes/${document.id}/review`); }}>
        <strong>{document.filename}</strong>
        <span className="muted">{INPUT_LABEL[document.input_kind]} · {formatSize(document.byte_size)} · {new Date(document.created_at).toLocaleString('ko-KR')}</span>
      </a>
      {/* 후보 0건(NO_FACT_CANDIDATES)은 원문을 읽었으므로 '읽기 실패'가 아니라 직접 추가가 필요한 확인 대기로 보여준다. */}
      {document.extraction_status === 'failed' && document.error_code === 'NO_FACT_CANDIDATES'
        ? <span className="state review_required">자동 후보 0건 · 직접 추가 필요</span>
        : <span className={`state ${document.extraction_status}`}>{statusText[document.extraction_status]}</span>}
      {document.data_origin === 'synthetic' && <span className="pill">합성 예시</span>}
      {current_fact_revision_id && <span className="pill">확정 경력 있음</span>}
    </li>)}
  </ul>;
}

export function StartPage() {
  const [items, setItems] = useState<DocumentSummary[] | null>(null);
  const [file, setFile] = useState<{ file: File; key: string } | null>(null);
  const [text, setText] = useState('');
  const [pasteKey, setPasteKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState<'upload' | 'paste' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.documents().then(value => setItems(value.items)).catch(failure => setError(describeError(failure))); }, []);

  const pick = (selected: File | undefined) => {
    setError(null);
    if (!selected) { setFile(null); return; }
    if (/\.doc$/i.test(selected.name)) setError('옛 Word(.doc)는 읽지 못합니다. Word에서 .docx 또는 PDF로 저장해 올려 주세요.');
    else if (selected.size > MAX_PDF_MB * 1024 * 1024) setError(`파일은 최대 ${MAX_PDF_MB}MB입니다.`);
    // 같은 파일을 다시 보내면 같은 key를 써서 중복 등록을 막는다.
    setFile({ file: selected, key: crypto.randomUUID() });
  };

  const submit = async (kind: 'upload' | 'paste') => {
    setBusy(kind); setError(null);
    try {
      const accepted = kind === 'upload' && file
        ? await api.uploadPdf(file.file, file.key)
        : await api.pasteText(text, 'pasted-resume.txt', pasteKey);
      navigate(`/resumes/${accepted.resource_id}/review`);
    } catch (failure) {
      // 전송 여부가 불명확할 수 있으므로 같은 내용의 재시도는 같은 key를 쓴다.
      setError(describeError(failure));
    } finally { setBusy(null); }
  };

  return <>
    <section className="hero compact">
      <span className="eyebrow">U01 · 이력서 등록</span>
      {/* 제품 목적(사용자 지시 2026-11-21): 공고 추천이 아니라, 관심 가는 공고에 맞춰 이력서를 수정·보완하는 것. */}
      <h1>관심 있는 공고에 맞춰<br /><span>이력서를 다듬어 드릴게요.</span></h1>
      <p>지금은 <strong>PDF(최대 {MAX_PDF_MB}MB, 30쪽)</strong>, <strong>Word(.docx, 최대 {MAX_PDF_MB}MB)</strong>, <strong>텍스트 붙여넣기</strong>를 지원합니다. Word는 본문과 표만 읽고 머리글·바닥글·이미지는 읽지 않습니다. 스캔본 PDF(그림으로 된 PDF, 최대 8쪽)는 글자 인식으로 읽는데, 일부 글자가 인식되지 않거나 틀릴 수 있어 확인 화면에서 경고를 보여 드립니다. 옛 Word(.doc)는 읽지 못하니 .docx로 저장하거나 내용을 붙여넣어 주세요.</p>
    </section>
    <div className="intake-grid">
      <section className="panel" aria-labelledby="upload-title">
        <h2 id="upload-title">파일 올리기(PDF·Word)</h2>
        <label className="file-drop">
          <input type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={event => pick(event.target.files?.[0])} />
          <span>{file ? '다른 파일 선택' : 'PDF 또는 Word(.docx) 파일 선택'}</span>
        </label>
        {file && <dl className="file-meta"><div><dt>파일</dt><dd>{file.file.name}</dd></div><div><dt>형식</dt><dd>{file.file.type || '알 수 없음'}</dd></div><div><dt>크기</dt><dd>{formatSize(file.file.size)}</dd></div></dl>}
        <button className="primary" disabled={!file || busy !== null} onClick={() => submit('upload')}>{busy === 'upload' ? '올리는 중…' : '이 파일 등록'}</button>
      </section>
      <section className="panel" aria-labelledby="paste-title" id="paste">
        <h2 id="paste-title">텍스트로 붙여넣기</h2>
        <textarea aria-label="이력서 텍스트" value={text} maxLength={MAX_PASTE} onChange={event => { setText(event.target.value); setPasteKey(crypto.randomUUID()); }} placeholder="이력서 내용을 그대로 붙여넣어 주세요." />
        <p className="fine-print">{text.length.toLocaleString()} / {MAX_PASTE.toLocaleString()}자</p>
        <button className="primary" disabled={text.trim().length === 0 || busy !== null} onClick={() => submit('paste')}>{busy === 'paste' ? '등록 중…' : '붙여넣은 내용 등록'}</button>
      </section>
    </div>
    {error && <div role="alert" className="error">{error}</div>}
    <p className="fine-print">개발 확인용 합성 이력서는 저장소의 <code>fixtures/resumes/</code>에 있습니다. 같은 업로드·추출 경로를 거치며, 서버가 파일 hash로 합성 예시를 구분해 표시합니다.</p>
    <div className="section-title"><h2>내 이력서 원본</h2></div>
    {items ? <DocumentList items={items} /> : <p role="status" className="status-line">목록을 불러오는 중…</p>}
  </>;
}
