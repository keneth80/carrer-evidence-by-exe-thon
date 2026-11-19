import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, describeError } from './api.ts';
import type { ProductSession } from './api.ts';

// 서버 세션이 없으면 로컬 개발 연결을 먼저 만든다. 운영 로그인 화면이 아니다.
export function SessionGate({ children }: { children: (session: ProductSession, logout: () => void) => ReactNode }) {
  const [session, setSession] = useState<ProductSession | null>(null);
  const [state, setState] = useState<'loading' | 'signed_out' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState('me');

  useEffect(() => {
    api.session()
      .then(value => { setSession(value); setState('ready'); })
      .catch((failure: unknown) => {
        if (failure instanceof ApiError && failure.status === 401) setState('signed_out');
        else { setError(describeError(failure)); setState('error'); }
      });
  }, []);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await api.login(profile.trim().toLowerCase());
      setSession(result.session);
      setState('ready');
    } catch (failure) { setError(describeError(failure)); }
  };

  const logout = () => {
    api.logout().catch(() => undefined).finally(() => { setSession(null); setState('signed_out'); });
  };

  if (state === 'loading') return <p role="status" className="status-line">연결 상태를 확인하는 중…</p>;
  if (state === 'error') return <div role="alert" className="error">{error}</div>;
  if (state === 'ready' && session) return <>{children(session, logout)}</>;
  return <section className="panel narrow" aria-labelledby="connect-title">
    <span className="small-label">LOCAL DEV SESSION</span>
    <h2 id="connect-title">로컬 개발 사용자로 연결</h2>
    <p className="muted">이 화면은 127.0.0.1 개발 환경 전용 연결입니다. 운영 로그인은 아직 구현되지 않았습니다. 다른 이름으로 연결하면 서로 다른 사용자 공간이 만들어지고 자료가 분리됩니다.</p>
    <form className="inline-form" onSubmit={connect}>
      <label>사용자 이름<input value={profile} onChange={event => setProfile(event.target.value)} pattern="[a-z0-9][a-z0-9_\-]{0,31}" required aria-describedby="profile-help" /></label>
      <button className="primary" type="submit">연결</button>
    </form>
    <p id="profile-help" className="fine-print">영문 소문자·숫자·-·_ 1~32자</p>
    {error && <div role="alert" className="error">{error}</div>}
  </section>;
}
