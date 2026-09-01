import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AuthError, getSnapshot, subscribe, trySilentSignIn } from './auth/session';
import { fetchMyProfile, type MyProfile } from './gmail/profile';
import { GmailError } from './gmail/http';
import { DEV_DISPLAY_NAME } from './config';
import { LoginScreen } from './ui/screens/LoginScreen';
import { MainScreen } from './ui/screens/MainScreen';
import { log } from './lib/log';

export function App() {
  const session = useSyncExternalStore(subscribe, getSnapshot);
  const [checking, setChecking] = useState(true);

  // 起動時に画面を出さずに取得を試みる（要件定義書 2.3 手順1）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await trySilentSignIn();
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!session) {
    return checking ? <Loading /> : <LoginScreen />;
  }
  return <SignedIn />;
}

function Loading() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
      <p>読み込んでいます…</p>
    </main>
  );
}

function SignedIn() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfile(await fetchMyProfile());
    } catch (e) {
      log.error('プロフィールの取得に失敗', e);
      setError(
        e instanceof GmailError || e instanceof AuthError
          ? e.userMessage
          : '情報を取得できませんでした。時間をおいてもう一度お試しください。',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem' }}>
        <p role="alert" style={{ color: 'var(--accent-strong)' }}>
          {error}
        </p>
        <button type="button" onClick={() => void load()}>
          もう一度試す
        </button>
      </main>
    );
  }

  if (!profile) return <Loading />;

  return (
    <MainScreen profile={profile} myDisplayName={profile.displayName ?? DEV_DISPLAY_NAME} />
  );
}
