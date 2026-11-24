import test from 'node:test';
import assert from 'node:assert/strict';
import { linerWaiting, progressView, SUPPLEMENT_PROGRESS, TAILOR_PROGRESS } from '../apps/web/src/resume/progress.ts';

// Liner 응답을 기다리는 동안 'HR 담당자가 검토중입니다'와 연필 로딩바를 보인다(사용자 요청 2026-11-24, DECISIONS S1-39).
// 규칙 점검·요구사항 대조처럼 이 컴퓨터 안에서 끝나는 단계와, 작업이 아직 시작되지 않은 대기에는 보이지 않는다.

const progress = (taskId, stages) => ({ task_id: taskId, mode: 'staged', started_at: '2026-11-24T00:00:00Z', stages });
const stage = (key, state) => ({ key, label: key, state, note: null });

test('Liner stages show the HR reviewing loader, local stages do not', () => {
  for (const key of ['review', 'draft', 'critic', 'single']) assert.equal(linerWaiting(key), true, key);
  for (const key of ['rules', 'match', null, 'unknown']) assert.equal(linerWaiting(key), false, String(key));
});

test('the loader follows the running stage of this task', () => {
  const running = progressView(progress('t1', [stage('rules', 'done'), stage('review', 'running'), stage('draft', 'skipped'), stage('critic', 'skipped')]), 't1', 'staged', true, SUPPLEMENT_PROGRESS);
  assert.equal(linerWaiting(running.currentKey), true);
  const local = progressView(progress('t2', [stage('match', 'running'), stage('review', 'pending')]), 't2', 'staged', true, TAILOR_PROGRESS);
  assert.equal(linerWaiting(local.currentKey), false);
});
