import { randomUUID } from 'node:crypto';
import { answerIssues, payloadHash, sha256 } from '../../../packages/apply/src/payload.ts';
import { SELF_FORM_QUESTIONS, demoPosting, selfFormTarget } from '../../../packages/apply/src/self-form.ts';
import { companyKey, fixedDocumentIssues, isExcludedCompany, MIN_SIMILARITY, similarity } from '../../../packages/apply/src/similarity.ts';
import type { Answer } from '../../../packages/apply/src/types.ts';
import { missingGlyphs, renderResumePdf } from '../../../packages/render/src/resume-pdf.ts';
import { evaluateConditions } from '../../../packages/search/src/job-attributes.ts';
import { buildQueryPlans } from '../../../packages/search/src/intent.ts';
import type { SearchProvider } from '../../../packages/search/src/provider.ts';
import { SearchProviderError } from '../../../packages/search/src/provider.ts';
import type { Condition, JobDraft } from '../../../packages/search/src/types.ts';
import { applyChanges, baseBlocks, blocksCanonical } from '../../../packages/tailor/src/blocks.ts';
import { checkBlocks, checkChange } from '../../../packages/tailor/src/guard.ts';
import type { ChatProvider } from '../../../packages/tailor/src/provider.ts';
import type { FactLike, ProposedChange, ResumeBlock } from '../../../packages/tailor/src/types.ts';
import { getApplication, getAppRevision, readVerifiedArtifact, revisionAnswers, submissionState } from '../../api/src/apply/repository.ts';
import { getCampaign } from '../../api/src/automation/campaigns.ts';
import type { CampaignRow } from '../../api/src/automation/campaigns.ts';
import { getPolicyControl, getPolicyRevision, policyRunProblem } from '../../api/src/automation/policies.ts';
import type { PolicyRevisionRow } from '../../api/src/automation/policies.ts';
import type { ObjectStore } from '../../api/src/resume/storage.ts';
import { otherCompanies } from '../../api/src/tailor/revisions.ts';
import { insertRevision } from '../../api/src/tailor/repository.ts';
import { claimTask, completeTask, failTask, holdsLease, inTransaction, markDispatched, MAX_ATTEMPTS, withHeartbeat } from './lease.ts';
import type { LeaseDeps, LeasedTask } from './lease.ts';
import { safeUrl, snapshotHash } from './search-task.ts';

// discover_similar 작업(S06): 고정한 기준(seed)으로 비슷한 공고를 찾고, 조건·중복·사이트·문항을 확인해 대기함에 넣는다.
// prepare 모드는 공고별 이력서 revision·PDF·지원 건(답변 초안)까지 만들지만 권한·시도·제출은 만들지 않는다.
// 캠페인이 만든 지원 건·공고는 다음 실행의 기준이 되지 않는다(기준은 캠페인 행에 고정).

export type DiscoverDeps = LeaseDeps & { search: SearchProvider; chat: ChatProvider; store: ObjectStore };
export type DiscoverRunResult = 'idle' | 'succeeded' | 'failed' | 'canceled' | 'lease_lost';
type State = 'discovered' | 'needs_review' | 'eligible' | 'prepared' | 'skipped';
type Evaluation = {
  mode: string; score: number; reasons: ReturnType<typeof similarity>['reasons']; shared_skills: string[];
  conditions: { field: string; importance: string; state: string; detail: string }[];
  duplicate: { kind: 'none' | 'same_job' | 'possible_same'; detail: string };
  needs: string[]; notes: string[]; held: boolean;
  document: { strategy: string; resume_revision_id: string; artifact_id: string; artifact_sha256: string; filename: string } | null;
  decided_at: string;
};
type Context = { ws: string; generation: number; campaign: CampaignRow; policy: PolicyRevisionRow; conditions: Condition[]; seedJob: JobDraft; seedBlocks: ResumeBlock[]; facts: FactLike[]; seedAnswers: Answer[] };

const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const IDENTITY_QUESTIONS = ['applicant_name', 'applicant_email'];
const EDIT_KIND: Record<ProposedChange['operation'], string> = { reorder: 'reorder', insert: 'summary', replace: 'rewrite_with_facts', remove: 'rewrite_with_facts' };
const STATE_LABEL: Record<string, string> = { submitted: '접수 확인됨', submission_unknown: '접수 여부 불명', running: '전송 중', queued: '제출 승인됨', prepared: '폼 확인됨', draft: '작성 중', waiting_user: '확인 필요', not_submitted: '미접수 확정' };

function loadContext(deps: DiscoverDeps, task: LeasedTask): Context | string {
  let input: { campaign_id?: unknown; policy_revision_id?: unknown; policy_generation?: unknown };
  try { input = JSON.parse(task.inputJson); } catch { return 'TASK_INPUT_INVALID'; }
  const ws = task.workspaceId;
  const campaign = typeof input.campaign_id === 'string' ? getCampaign(deps.db, ws, input.campaign_id) : undefined;
  if (!campaign || campaign.policy_revision_id !== input.policy_revision_id) return 'TASK_INPUT_INVALID';
  if (campaign.state !== 'active') return 'CAMPAIGN_NOT_ACTIVE';
  const policy = getPolicyRevision(deps.db, ws, campaign.policy_revision_id)!;
  const blocked = policyRunProblem(deps.db, ws, policy, deps.now());
  if (blocked) return blocked;
  // 실행 예약 뒤 정책이 바뀌었으면(일시중지·철회·재활성화) 이 작업은 실행하지 않는다.
  if (getPolicyControl(deps.db, ws, policy.policy_id)!.generation !== input.policy_generation) return 'POLICY_CHANGED';
  const seedRevision = getAppRevision(deps.db, ws, campaign.seed_application_id, campaign.seed_application_revision)!;
  const seedJob = deps.db.prepare('SELECT * FROM ce7_job_snapshots WHERE workspace_id = ? AND id = ?').get(ws, campaign.seed_job_snapshot_id) as Record<string, unknown>;
  const seedResume = deps.db.prepare('SELECT blocks_json FROM ce7_resume_revisions WHERE workspace_id = ? AND id = ?').get(ws, campaign.seed_resume_revision_id) as { blocks_json: string };
  const facts = deps.db.prepare('SELECT facts_json FROM ce7_fact_revisions WHERE workspace_id = ? AND id = ?').get(ws, policy.fact_revision_id) as { facts_json: string };
  return {
    ws, generation: Number(input.policy_generation), campaign, policy, conditions: JSON.parse(policy.conditions_json) as Condition[],
    seedJob: { job_key: String(seedJob.job_key), company_name: String(seedJob.company_name), title: String(seedJob.title), canonical_url: String(seedJob.canonical_url), site_id: String(seedJob.site_id), content_text: String(seedJob.content_text), requirements: JSON.parse(String(seedJob.requirements_json)), open_status: seedJob.open_status as JobDraft['open_status'], data_origin: seedJob.data_origin as JobDraft['data_origin'] },
    seedBlocks: JSON.parse(seedResume.blocks_json) as ResumeBlock[], facts: JSON.parse(facts.facts_json) as FactLike[], seedAnswers: revisionAnswers(seedRevision),
  };
}

// 이미 지원 건·외부 지원 기록이 있는 공고는 건너뛰고, 다른 사이트의 같은 공고일 수 있으면(회사·직무명만 같음) 검토로 보낸다.
function duplicateOf(deps: DiscoverDeps, ws: string, job: JobDraft): Evaluation['duplicate'] {
  const app = deps.db.prepare('SELECT * FROM ce7_applications WHERE workspace_id = ? AND job_key = ?').get(ws, job.job_key) as Parameters<typeof submissionState>[1] | undefined;
  if (app) return { kind: 'same_job', detail: `이미 이 공고의 지원 건이 있습니다(${STATE_LABEL[submissionState(deps.db, app)] ?? '진행 중'}).` };
  if (deps.db.prepare('SELECT 1 FROM ce8_external_applications WHERE workspace_id = ? AND job_key = ?').get(ws, job.job_key)) return { kind: 'same_job', detail: '다른 경로로 이미 지원했다고 기록한 공고입니다.' };
  const key = `${companyKey(job.company_name)}|${companyKey(job.title)}`;
  const known = [
    ...(deps.db.prepare('SELECT j.company_name, j.title FROM ce7_applications a JOIN ce7_application_revisions r ON r.workspace_id = a.workspace_id AND r.application_id = a.id AND r.revision = a.current_revision JOIN ce7_job_snapshots j ON j.workspace_id = r.workspace_id AND j.id = r.job_snapshot_id WHERE a.workspace_id = ?').all(ws) as { company_name: string; title: string }[]),
    ...(deps.db.prepare('SELECT company_name, title FROM ce8_external_applications WHERE workspace_id = ?').all(ws) as { company_name: string; title: string }[]),
  ];
  if (known.some(item => `${companyKey(item.company_name)}|${companyKey(item.title)}` === key)) return { kind: 'possible_same', detail: '회사·직무명이 같은 지원 기록이 있습니다. 다른 사이트의 같은 공고인지 확인이 필요합니다.' };
  return { kind: 'none', detail: '' };
}

// 준비 한도는 같은 정책(policy_id)의 모든 캠페인·revision을 합쳐 센다(revision을 바꿔도 사용량을 초기화하지 않는다).
function preparedCounts(deps: DiscoverDeps, context: Context): { total: number; today: number } {
  const row = deps.db.prepare(`SELECT count(*) AS total, sum(CASE WHEN a.created_at_ms >= ? THEN 1 ELSE 0 END) AS today FROM ce7_campaign_jobs c
    JOIN ce7_campaigns k ON k.workspace_id = c.workspace_id AND k.id = c.campaign_id JOIN ce7_policy_revisions p ON p.workspace_id = k.workspace_id AND p.id = k.policy_revision_id
    JOIN ce7_applications a ON a.workspace_id = c.workspace_id AND a.id = c.application_id
    WHERE c.workspace_id = ? AND p.policy_id = ? AND c.state = 'prepared'`).get(seoulDayStart(deps.now()), context.ws, context.policy.policy_id) as { total: number; today: number | null };
  return { total: Number(row.total), today: Number(row.today ?? 0) };
}
const limitNote = (deps: DiscoverDeps, context: Context): string | null => {
  const counts = preparedCounts(deps, context);
  if (counts.total >= context.policy.total_limit) return `정책 전체 준비 한도(${context.policy.total_limit}건)에 도달해 서류를 만들지 않았습니다.`;
  if (counts.today >= context.policy.daily_limit) return `오늘 준비 한도(${context.policy.daily_limit}건)에 도달해 서류를 만들지 않았습니다. 다시 찾기를 하면 다시 판단합니다.`;
  return null;
};

const seoulDayStart = (nowMs: number) => { const offset = 9 * 3600_000; return Math.floor((nowMs + offset) / 86_400_000) * 86_400_000 - offset; };

function evaluate(deps: DiscoverDeps, context: Context, job: JobDraft): { state: State; evaluation: Evaluation; prepare: boolean } {
  const sim = similarity(context.seedJob, job);
  const results = evaluateConditions(context.conditions, job.content_text, job.title);
  const evaluation: Evaluation = {
    mode: context.policy.mode, score: sim.score, reasons: sim.reasons, shared_skills: sim.shared_skills,
    conditions: results.map(result => ({ field: result.condition.field, importance: result.condition.importance, state: result.state, detail: result.detail })),
    duplicate: duplicateOf(deps, context.ws, job), needs: [], notes: [], held: false, document: null, decided_at: new Date(deps.now()).toISOString(),
  };
  const skip = (note: string) => ({ state: 'skipped' as const, evaluation: { ...evaluation, notes: [...evaluation.notes, note] }, prepare: false });
  if (isExcludedCompany(job.company_name, JSON.parse(context.policy.excluded_companies_json) as string[])) return skip('정책에서 제외한 회사입니다.');
  if (evaluation.duplicate.kind === 'same_job') return skip(evaluation.duplicate.detail);
  if (job.open_status === 'closed') return skip('마감된 공고입니다.');
  if (sim.score < MIN_SIMILARITY) return skip(`기준 공고와 유사도가 낮습니다(${sim.score}).`);
  const unmet = results.filter(result => result.condition.importance === 'required' && result.state === 'unmet');
  if (unmet.length) return skip(`필수 조건 미충족: ${unmet.map(result => result.detail).join(', ')}`);
  for (const result of results) {
    if (result.condition.importance === 'required' && result.state === 'unknown') evaluation.needs.push(`필수 조건 확인 필요: ${result.detail}`);
    if (result.condition.importance === 'preferred' && result.state === 'unmet') evaluation.notes.push(`선호 조건 미충족: ${result.detail}`);
  }
  if (evaluation.duplicate.kind === 'possible_same') evaluation.needs.push(evaluation.duplicate.detail);
  const target = selfFormTarget(job);
  if (!target) evaluation.needs.push('자동 입력을 지원하지 않는 지원 사이트입니다. 직접 지원 여부를 판단해 주세요.');
  else {
    const extra = demoPosting(target.posting_id)!.questions.filter(question => question.required && !SELF_FORM_QUESTIONS.some(known => known.question_id === question.question_id));
    if (extra.length) evaluation.needs.push(`새 필수 문항이 있습니다: ${extra.map(question => question.label).join(', ')}. 직접 답해야 합니다.`);
  }
  if (evaluation.needs.length) return { state: 'needs_review', evaluation, prepare: false };
  if (context.policy.mode === 'recommend') return { state: 'eligible', evaluation: { ...evaluation, notes: [...evaluation.notes, '추천 모드: 서류를 만들지 않았습니다.'] }, prepare: false };
  const held = limitNote(deps, context);
  if (held) return { state: 'eligible', evaluation: { ...evaluation, held: true, notes: [...evaluation.notes, held] }, prepare: false };
  return { state: 'eligible', evaluation, prepare: true };
}

type Documents = { kind: 'fixed'; resumeRevisionId: string; artifactId: string; sha256: string; filename: string }
  | { kind: 'tailored'; base: ResumeBlock[]; blocks: ResumeBlock[]; bytes: Uint8Array; filename: string };

// 공고별 서류: 확정 파일 그대로(기준 공고 회사명·전용 문구 점검) 또는 확정 사실 범위의 순서·요약 조정으로 새 revision과 PDF.
async function buildDocuments(deps: DiscoverDeps, context: Context, job: JobDraft, signal: AbortSignal): Promise<Documents | { issues: string[] }> {
  const otherNames = (blocks: ResumeBlock[]) => otherCompanies(deps.db, context.ws, job.company_name, blocks, context.facts).map(name => `이력서에 다른 공고의 회사 이름(${name})이 있습니다.`);
  if (context.policy.document_strategy === 'fixed_document') {
    const issues = [...new Set([...fixedDocumentIssues(context.seedBlocks, context.seedJob, job).map(issue => issue.message), ...otherNames(context.seedBlocks)])];
    if (issues.length) return { issues };
    const file = readVerifiedArtifact(deps.db, deps.store, context.ws, context.policy.fixed_artifact_id!);
    if ('error' in file) return { issues: ['정책에 고정한 PDF를 확인할 수 없습니다.'] };
    return { kind: 'fixed', resumeRevisionId: context.policy.seed_resume_revision_id, artifactId: file.row.id, sha256: file.row.sha256, filename: file.row.filename };
  }
  const allowed = JSON.parse(context.policy.allowed_edits_json) as string[];
  const base = baseBlocks(context.facts);
  const output = await deps.chat.respond({ job: { company_name: job.company_name, title: job.title, content_text: job.content_text, requirements: job.requirements }, facts: context.facts, blocks: base, history: [], message: '이 공고에 맞춰 수정해줘', signal });
  let blocks = base;
  for (const change of output.changes) {
    if (change.needs_fact_confirmation || !allowed.includes(EDIT_KIND[change.operation]) || checkChange(change, context.facts).length) continue;
    const applied = applyChanges(blocks, [change]);
    if (applied.ok) blocks = applied.blocks;
  }
  const issues = [...checkBlocks(blocks, context.facts).map(item => `근거 범위를 넘는 문장: ${item.issues[0].detail}`), ...otherNames(blocks)];
  const missing = missingGlyphs(blocks.map(block => block.text));
  if (missing.length) issues.push(`PDF 글꼴에 없는 글자: ${missing.join(' ')}`);
  if (issues.length) return { issues };
  const rendered = await renderResumePdf({ blocks, title: '이력서', finalizedAt: new Date(deps.now()) });
  const company = job.company_name.replace(/\(합성\)/g, '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return { kind: 'tailored', base, blocks, bytes: rendered.bytes, filename: `이력서_${company || '회사'}_자동준비.pdf` };
}

// 후보 하나를 한 transaction에 기록한다(공고 snapshot·서류·지원 건·대기함 행). lease를 잃었으면 쓰지 않는다.
type RecordResult = State | 'lease_lost' | 'policy_changed';
function record(deps: DiscoverDeps, task: LeasedTask, context: Context, job: JobDraft, decision: { state: State; evaluation: Evaluation }, docs: Documents | null, objectKey: string | null, heldSnapshotId: string | null): RecordResult {
  return inTransaction(deps.db, (): RecordResult => {
    if (!holdsLease(deps, task)) return 'lease_lost';
    const { ws } = context;
    const now = deps.now();
    // 실행 중 정책이 멈추거나 바뀌거나 만료되면 남은 후보를 기록하지 않는다.
    if (policyChanged(deps, context)) return 'policy_changed';
    if (heldSnapshotId) deps.db.prepare('DELETE FROM ce7_campaign_jobs WHERE workspace_id = ? AND campaign_id = ? AND job_snapshot_id = ?').run(ws, context.campaign.id, heldSnapshotId);
    const snapshotId = newId('job');
    deps.db.prepare(`INSERT INTO ce7_job_snapshots (id, workspace_id, job_key, company_name, title, canonical_url, site_id, content_text, requirements_json, content_hash, open_status, data_origin, observed_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(snapshotId, ws, job.job_key, job.company_name, job.title, job.canonical_url, job.site_id, job.content_text, JSON.stringify(job.requirements), snapshotHash(job), job.open_status, job.data_origin, now);
    let state = decision.state;
    let evaluation = decision.evaluation;
    let applicationId: string | null = null;
    // 기록 직전 다시 확인: 그사이 사용자가 같은 공고의 지원 건을 만들었으면 건너뛴다.
    const raced = deps.db.prepare('SELECT 1 FROM ce7_applications WHERE workspace_id = ? AND job_key = ?').get(ws, job.job_key);
    const overLimit = docs ? limitNote(deps, context) : null;
    if (docs && raced) { state = 'skipped'; evaluation = { ...evaluation, notes: [...evaluation.notes, '준비하는 동안 같은 공고의 지원 건이 생겨 건너뛰었습니다.'] }; }
    else if (docs && overLimit) { state = 'eligible'; evaluation = { ...evaluation, held: true, notes: [...evaluation.notes, overLimit] }; }
    else if (docs) {
      let resumeRevisionId: string;
      let artifact: { id: string; sha256: string; filename: string };
      if (docs.kind === 'fixed') {
        resumeRevisionId = docs.resumeRevisionId;
        artifact = { id: docs.artifactId, sha256: docs.sha256, filename: docs.filename };
      } else {
        const sessionId = newId('session');
        deps.db.prepare("INSERT INTO ce7_tailoring_sessions (id, workspace_id, job_snapshot_id, fact_revision_id, current_resume_revision_id, revision, state, created_at_ms) VALUES (?, ?, ?, ?, NULL, 0, 'editing', ?)").run(sessionId, ws, snapshotId, context.policy.fact_revision_id, now);
        const baseId = newId('resume');
        insertRevision(deps.db, { id: baseId, workspace_id: ws, session_id: sessionId, job_snapshot_id: snapshotId, fact_revision_id: context.policy.fact_revision_id, revision: 1, parent_revision_id: null, blocks_json: JSON.stringify(docs.base), content_hash: sha256(blocksCanonical(docs.base)), created_at_ms: now });
        resumeRevisionId = newId('resume');
        insertRevision(deps.db, { id: resumeRevisionId, workspace_id: ws, session_id: sessionId, job_snapshot_id: snapshotId, fact_revision_id: context.policy.fact_revision_id, revision: 2, parent_revision_id: baseId, blocks_json: JSON.stringify(docs.blocks), content_hash: sha256(blocksCanonical(docs.blocks)), created_at_ms: now });
        // 정책에 따른 확정이다. 사용자가 확인했다고 표시하지 않는다(finalization_source=policy).
        deps.db.prepare("UPDATE ce7_resume_revisions SET state = 'final', finalized_at_ms = ?, finalization_source = 'policy' WHERE workspace_id = ? AND id = ?").run(now, ws, resumeRevisionId);
        const artifactId = newId('artifact');
        deps.db.prepare('INSERT INTO ce7_artifacts (id, workspace_id, resume_revision_id, filename, mime_type, byte_size, sha256, object_key, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(artifactId, ws, resumeRevisionId, docs.filename, 'application/pdf', docs.bytes.length, sha256(docs.bytes), objectKey!, now);
        artifact = { id: artifactId, sha256: sha256(docs.bytes), filename: docs.filename };
      }
      // 답변 초안: 이름·이메일만 기준 지원서의 사용자 답변을 가져온다. 지원 동기·동의는 공고마다 사용자가 직접 답한다.
      const answers = context.seedAnswers.filter(answer => IDENTITY_QUESTIONS.includes(answer.question_id));
      applicationId = newId('application');
      deps.db.prepare("INSERT INTO ce7_applications (id, workspace_id, job_key, current_revision, source_kind, source_campaign_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 1, 'campaign', ?, ?, ?)").run(applicationId, ws, job.job_key, context.campaign.id, now, now);
      const hash = payloadHash({ job_snapshot_id: snapshotId, job_content_hash: snapshotHash(job), resume_revision_id: resumeRevisionId, artifact_id: artifact.id, artifact_sha256: artifact.sha256, answers });
      deps.db.prepare('INSERT INTO ce7_application_revisions (workspace_id, application_id, revision, job_snapshot_id, resume_revision_id, artifact_id, artifact_sha256, answers_json, payload_hash, created_at_ms) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)')
        .run(ws, applicationId, snapshotId, resumeRevisionId, artifact.id, artifact.sha256, JSON.stringify(answers), hash, now);
      const pending = answerIssues(answers, SELF_FORM_QUESTIONS).map(issue => issue.message);
      state = 'prepared';
      evaluation = {
        ...evaluation, document: { strategy: context.policy.document_strategy, resume_revision_id: resumeRevisionId, artifact_id: artifact.id, artifact_sha256: artifact.sha256, filename: artifact.filename },
        needs: [...pending, '지원서 화면에서 답변을 확인하고 폼 확인·승인을 직접 진행해야 제출됩니다.'],
        notes: [...evaluation.notes, answers.length ? '이름·이메일은 기준 지원서의 답변을 가져왔습니다. 확인해 주세요.' : '기준 지원서에 재사용할 답변이 없습니다.'],
      };
    }
    deps.db.prepare('INSERT INTO ce7_campaign_jobs (workspace_id, campaign_id, job_snapshot_id, application_id, state, similarity_json) VALUES (?, ?, ?, ?, ?, ?)').run(ws, context.campaign.id, snapshotId, applicationId, state, JSON.stringify(evaluation));
    return state;
  });
}

function policyChanged(deps: DiscoverDeps, context: Context): boolean {
  return policyRunProblem(deps.db, context.ws, context.policy, deps.now()) !== null || getPolicyControl(deps.db, context.ws, context.policy.policy_id)?.generation !== context.generation;
}

function stillWanted(deps: DiscoverDeps, task: LeasedTask, context: Context): boolean {
  const row = deps.db.prepare('SELECT cancel_requested FROM ce7_tasks WHERE id = ?').get(task.taskId) as { cancel_requested: number };
  const campaign = getCampaign(deps.db, task.workspaceId, context.campaign.id);
  return row.cancel_requested === 0 && campaign?.state === 'active' && !policyChanged(deps, context);
}

function finishCanceled(deps: DiscoverDeps, task: LeasedTask): DiscoverRunResult {
  return inTransaction(deps.db, () => {
    if (!holdsLease(deps, task)) return 'lease_lost';
    deps.db.prepare("UPDATE ce7_tasks SET state = 'canceled', provider_transmission = 'completed', lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ? WHERE id = ?").run(deps.now(), task.taskId);
    return 'canceled';
  });
}

export async function runDiscoverTask(deps: DiscoverDeps, taskId?: string): Promise<DiscoverRunResult> {
  const task = claimTask(deps, 'discover_similar', taskId);
  if (!task) return 'idle';
  const fail = (code: string, transmission: 'not_dispatched' | 'completed' | 'unknown' = 'not_dispatched'): DiscoverRunResult => failTask(deps, task, code, transmission) ? 'failed' : 'lease_lost';
  // 유료(live) 검색·대화 호출이 전송된 뒤 끊겼으면 자동으로 다시 호출하지 않는다.
  if (task.previousTransmission === 'dispatched' && (deps.search.mode === 'live' || deps.chat.mode === 'live')) return fail('PROVIDER_TRANSMISSION_UNKNOWN', 'unknown');
  if (task.generation > MAX_ATTEMPTS) return fail('DISCOVER_ATTEMPTS_EXCEEDED');
  const context = loadContext(deps, task);
  if (typeof context === 'string') return context === 'CAMPAIGN_NOT_ACTIVE' ? finishCanceled(deps, task) : fail(context);
  const plans = buildQueryPlans(context.facts);
  if (!plans.ok) return fail(plans.code);
  if (!markDispatched(deps, task)) return holdsLease(deps, task) ? finishCanceled(deps, task) : 'lease_lost';
  const counts = { discovered: 0, prepared: 0, needs_review: 0, eligible: 0, skipped: 0 };
  try {
    const outcome = await withHeartbeat(deps, task, async signal => {
      const found = await deps.search.search({ queries: plans.queries, conditions: context.conditions, maxCandidates: 10, signal, call: { workspaceId: task.workspaceId, taskId: task.taskId, leaseGeneration: task.generation } });
      for (const job of found.jobs.filter(item => safeUrl(item.canonical_url))) {
        if (signal.aborted) return 'lease_lost' as const;
        if (!stillWanted(deps, task, context)) return 'canceled' as const;
        if (job.job_key === context.seedJob.job_key) continue;
        // 이미 판단한 공고는 다시 넣지 않는다. 한도 때문에 보류한 공고만 다시 판단한다.
        const seen = deps.db.prepare("SELECT c.job_snapshot_id, c.state, json_extract(c.similarity_json, '$.held') AS held FROM ce7_campaign_jobs c JOIN ce7_job_snapshots j ON j.workspace_id = c.workspace_id AND j.id = c.job_snapshot_id WHERE c.workspace_id = ? AND c.campaign_id = ? AND j.job_key = ?").get(context.ws, context.campaign.id, job.job_key) as { job_snapshot_id: string; state: string; held: number | null } | undefined;
        if (seen && !(seen.state === 'eligible' && seen.held === 1)) continue;
        const decision = evaluate(deps, context, job);
        let docs: Documents | null = null;
        let objectKey: string | null = null;
        if (decision.prepare) {
          const built = await buildDocuments(deps, context, job, signal);
          if ('issues' in built) { decision.state = 'needs_review'; decision.evaluation.needs.push(...built.issues); }
          else {
            docs = built;
            if (built.kind === 'tailored') { objectKey = `artifacts/${newId('artifact')}.pdf`; deps.store.put(context.ws, objectKey, built.bytes); }
          }
        }
        let stored: RecordResult = 'lease_lost';
        try { stored = record(deps, task, context, job, decision, docs, objectKey, seen?.job_snapshot_id ?? null); } finally { if (objectKey && stored !== 'prepared') deps.store.remove(context.ws, objectKey); }
        if (stored === 'lease_lost') return 'lease_lost' as const;
        if (stored === 'policy_changed') return 'canceled' as const;
        counts[stored] += 1;
      }
      return 'done' as const;
    });
    if (outcome === 'lease_lost') return 'lease_lost';
    if (outcome === 'canceled') return finishCanceled(deps, task);
  } catch (error) {
    console.error('DISCOVER_FAILED', error instanceof Error ? error.message : 'unknown');
    // live 호출의 처리 여부를 모르면 completed로 덮지 않는다(자동 재시도·한도 반환 금지).
    const live = deps.search.mode === 'live' || deps.chat.mode === 'live';
    return fail('DISCOVER_FAILED', error instanceof SearchProviderError ? error.transmission : live ? 'unknown' : 'completed');
  }
  return inTransaction(deps.db, () => {
    if (!holdsLease(deps, task)) return 'lease_lost';
    completeTask(deps, task, 'succeeded', null, { campaign_id: context.campaign.id, ...counts }, 'completed');
    return 'succeeded';
  });
}

