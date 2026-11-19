import { useEffect, useState } from 'react';

// 대화 provider가 실제로 무엇인지 서버 health에서 읽는다(DECISIONS S4-14). 화면 표시가 설정과 어긋나지 않게 한다.
let cached: Promise<boolean> | null = null;
function fetchLiveChat(): Promise<boolean> {
  cached ??= fetch('/api/health').then(response => response.json()).then(body => body?.conversational_editing === 'implemented_liner_chat').catch(() => false);
  return cached;
}

export function useLiveChat(): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => { let alive = true; fetchLiveChat().then(value => { if (alive) setLive(value); }); return () => { alive = false; }; }, []);
  return live;
}
