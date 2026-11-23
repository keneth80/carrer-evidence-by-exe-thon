import type { LinerMessages } from '../../../../packages/liner/src/chat.ts';

const RETENTION_MS = 30 * 60_000;
const MAX_EXCHANGES = 20;

export function createLinerMessageCache() {
  // 화면에서 확인할 수 있을 만큼만 메모리에 보관한다. DB나 로그에는 본문을 남기지 않는다.
  const entries = new Map<string, { messages: LinerMessages; expiry: NodeJS.Timeout }>();
  const remove = (taskId: string) => {
    clearTimeout(entries.get(taskId)?.expiry);
    entries.delete(taskId);
  };
  return {
    set(taskId: string, messages: LinerMessages) {
      remove(taskId);
      if (entries.size >= MAX_EXCHANGES) {
        const oldest = entries.keys().next();
        if (!oldest.done) remove(oldest.value);
      }
      entries.set(taskId, { messages, expiry: setTimeout(() => remove(taskId), RETENTION_MS).unref() });
    },
    get(taskId: string) {
      return entries.get(taskId)?.messages ?? null;
    },
  };
}
