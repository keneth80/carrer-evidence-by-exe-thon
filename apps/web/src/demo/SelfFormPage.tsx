import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

// 개발용 자체 테스트 폼 '사이트' 화면. 제품 세션과 무관하게 공고별 지원서를 받는다(실제 기업 접수 아님).
// data-ce-* 표식은 확장의 self-form.v1 adapter가 읽는 사이트 구조다. 사람이 직접 입력해 제출할 수도 있다.

type Question = { question_id: string; label: string; kind: 'text' | 'email' | 'textarea' | 'checkbox'; required: boolean; max_length: number };
type Posting = { posting_id: string; company_name: string; title: string; questions: Question[]; notice: string };
type Receipt = { receipt_number: string; posting_id: string; submission_key: string; accepted_at: string; file: { name: string; size: number; sha256: string } };
type Failure = { code: string; message: string; fields?: string[] };

export function SelfFormIndex() {
  const [items, setItems] = useState<{ posting_id: string; company_name: string; title: string }[] | null>(null);
  useEffect(() => { fetch('/api/demo-site/postings').then(response => response.json()).then(body => setItems(body.items)).catch(() => setItems([])); }, []);
  return <main className="shell self-site">
    <section className="hero compact"><span className="eyebrow">자체 테스트 폼 · 개발용 사이트</span><h1>합성 공고 지원 폼</h1><p>Career Evidence 확장의 입력·첨부·제출 검증에 쓰는 사이트입니다. 실제 기업에 접수되지 않습니다.</p></section>
    <ul className="self-site-list">{(items ?? []).map(item => <li key={item.posting_id}><a href={`/demo/apply/${item.posting_id}`}>{item.company_name} · {item.title}</a></li>)}</ul>
  </main>;
}

export function SelfFormPage({ postingId }: { postingId: string }) {
  const [posting, setPosting] = useState<Posting | 'missing' | null>(null);
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    fetch(`/api/demo-site/postings/${postingId}`).then(async response => setPosting(response.ok ? await response.json() as Posting : 'missing')).catch(() => setPosting('missing'));
  }, [postingId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending || receipt) return;
    setSending(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/demo-site/postings/${postingId}/submissions`, { method: 'POST', body: new FormData(event.currentTarget) });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.receipt_number) setReceipt(body as Receipt);
      else setFailure({ code: body?.code ?? `HTTP_${response.status}`, message: body?.message ?? '접수하지 못했습니다.', fields: body?.fields });
    } catch {
      // 응답을 받지 못했다. 사이트가 접수했는지 이 화면에서는 알 수 없다.
      setFailure({ code: 'NETWORK_ERROR', message: '연결이 끊겨 접수 여부를 확인하지 못했습니다. 다시 제출하기 전에 접수 여부를 먼저 확인하세요.' });
    } finally {
      setSending(false);
    }
  };

  if (posting === null) return <main className="shell self-site"><p className="muted">불러오는 중…</p></main>;
  if (posting === 'missing') return <main className="shell self-site"><div className="error" role="alert">공고를 찾을 수 없습니다.</div></main>;

  return <main className="shell self-site">
    <a className="back" href="/demo/apply">← 공고 목록</a>
    <header className="self-site-head" data-ce-posting-id={posting.posting_id}>
      <span className="eyebrow">자체 테스트 폼 · 실제 접수 아님</span>
      <h1 data-ce-company>{posting.company_name}</h1>
      <p data-ce-title>{posting.title}</p>
    </header>
    <div className="notice">{posting.notice}</div>
    {receipt ? <section className="self-site-receipt" role="status" data-ce-receipt={receipt.receipt_number} data-ce-receipt-posting={receipt.posting_id} data-ce-receipt-key={receipt.submission_key}>
      <h2>접수가 완료되었습니다</h2>
      <dl>
        <div><dt>접수번호</dt><dd>{receipt.receipt_number}</dd></div>
        <div><dt>접수 시각</dt><dd>{new Date(receipt.accepted_at).toLocaleString('ko-KR')}</dd></div>
        <div><dt>첨부 파일</dt><dd>{receipt.file.name} · {(receipt.file.size / 1024).toFixed(1)}KB</dd></div>
        <div><dt>파일 SHA-256</dt><dd className="hash">{receipt.file.sha256}</dd></div>
      </dl>
    </section> : <form ref={form} className="self-site-form" data-ce-form="self-form.v1" noValidate onSubmit={submit}>
      <fieldset disabled={sending}>
        {posting.questions.map(question => <label key={question.question_id} className={question.kind === 'checkbox' ? 'check-field' : undefined}>
          <span data-ce-label>{question.label}</span>
          {question.kind === 'textarea'
            ? <textarea name={question.question_id} required={question.required} maxLength={question.max_length} rows={5} />
            : <input name={question.question_id} type={question.kind === 'checkbox' ? 'checkbox' : question.kind} required={question.required} maxLength={question.max_length} />}
          {failure?.fields?.includes(question.question_id) && <span className="field-error">필수 항목입니다.</span>}
        </label>)}
        <label>
          <span>이력서 PDF</span>
          <input name="resume_file" type="file" accept="application/pdf" required />
          {failure?.fields?.includes('resume_file') && <span className="field-error">PDF 파일을 첨부해 주세요.</span>}
        </label>
        <input type="hidden" name="submission_key" defaultValue="" />
        <button type="submit" className="primary" data-ce-submit>{sending ? '접수 중…' : '지원서 제출'}</button>
      </fieldset>
      {sending && <p className="muted" data-ce-status="sending">접수 중입니다. 창을 닫지 마세요.</p>}
      {failure && <p className="error" role="alert" data-ce-error={failure.code}>{failure.message}</p>}
    </form>}
  </main>;
}
