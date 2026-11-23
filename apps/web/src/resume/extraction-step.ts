import type { Task } from './api.ts';

// 이력서 읽기 단계(0 파일 읽기, 1 AI 정리, 2 원문 대조·저장). 화면(ExtractionProgress)과 분리해 테스트한다.
// 추정하지 않고 작업의 실제 상태만 본다: AI 호출을 보냈으면 1, 응답을 받았거나 결과를 알 수 없으면 2.
export function extractionStep(task: Pick<Task, 'state' | 'provider_transmission'> | null): number {
  if (!task || task.state !== 'running') return 0;
  return task.provider_transmission === 'dispatched' ? 1 : task.provider_transmission === 'completed' || task.provider_transmission === 'unknown' ? 2 : 0;
}

export function linerExchange(task: Pick<Task, 'state' | 'provider_transmission'>) {
  switch (task.provider_transmission) {
    case 'dispatched': return {
      request: '전송됨',
      response: task.state === 'running' ? '응답 대기 중' : '수신 여부 확인 불가',
    };
    case 'completed': return { request: '전송됨', response: '응답 수신됨' };
    case 'unknown': return { request: '전송 시도', response: '수신 여부 확인 불가' };
    case 'not_dispatched': return { request: '전송 내역 없음', response: '수신 내역 없음' };
    default: return { request: '전송 상태 확인 불가', response: '수신 상태 확인 불가' };
  }
}
