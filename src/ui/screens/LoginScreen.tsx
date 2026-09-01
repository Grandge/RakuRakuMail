/**
 * S-01 ログイン画面（要件定義書 5.1 / 5.4 / D-08）。
 *
 * 審査前のテストモードでは「このアプリは Google で確認されていません」という
 * 警告が出る。その通過手順をこの画面に書いておく（NFR-01）。
 *
 * 手順は 2026-09-01 に実際の警告画面を見て合わせたもの。目立つ青いボタンが
 * 「安全なページに戻る」（＝進めない側）で、進む側は左下の小さいリンク
 * 「続行」になっている。Google が画面を変えたら、ここも直すこと。
 */

import { useState } from 'react';
import { AuthError, signIn } from '../../auth/session';
import { APP_NAME } from '../../config';

type Props = {
  /** 起動時の裏取得が失敗した理由。初回は null。 */
  readonly initialNotice?: string | null;
};

export function LoginScreen({ initialNotice = null }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialNotice);

  async function handleSignIn() {
    setBusy(true);
    setMessage(null);
    try {
      // クリックハンドラの中から呼ぶこと。
      // 利用者の操作を伴わないとポップアップが塞がれる。
      await signIn();
    } catch (e) {
      setMessage(
        e instanceof AuthError
          ? e.userMessage
          : 'ログインできませんでした。少し時間をおいて、もう一度お試しください。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>{APP_NAME}</h1>
        <p style={styles.lead}>
          Gmail を使って、家族や友人とやり取りするためのアプリです。
          はじめに、お使いの Gmail でログインしてください。
        </p>

        {message !== null && (
          <p role="alert" style={styles.notice}>
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy}
          style={{ ...styles.primaryButton, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'ログインしています…' : 'Google でログイン'}
        </button>

        <section style={styles.help}>
          <h2 style={styles.helpTitle}>「確認されていません」と出たときは</h2>
          <p style={styles.helpText}>
            このアプリはまだ試験中のため、Google の警告画面が出ることがあります。
            出たときは、次の順に進んでください。
          </p>
          <ol style={styles.helpList}>
            <li>
              画面の左下にある <strong>「続行」</strong> を押します
            </li>
            <li>
              許可の確認画面が出たら、すべてにチェックを入れて <strong>「続行」</strong> を押します
            </li>
          </ol>
          <p style={styles.helpText}>
            右下にある目立つ青いボタン <strong>「安全なページに戻る」</strong> を押すと、
            先へ進めません。押すのは左下の小さな文字の <strong>「続行」</strong> です。
          </p>
          <p style={styles.helpText}>
            チェックを外すと、メールの送受信ができません。
          </p>
        </section>
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: '100dvh',
    display: 'grid',
    placeItems: 'center',
    padding: '1rem',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '1.5rem',
  },
  title: {
    margin: '0 0 0.5rem',
    color: 'var(--primary)',
    fontSize: '1.6rem',
  },
  lead: { margin: '0 0 1.25rem' },
  notice: {
    margin: '0 0 1rem',
    padding: '0.75rem 1rem',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--accent-strong)',
    color: 'var(--accent-strong)',
    background: 'var(--bg)',
  },
  primaryButton: {
    width: '100%',
    background: 'var(--accent-strong)',
    color: 'var(--on-primary)',
    fontWeight: 700,
  },
  help: {
    marginTop: '1.5rem',
    paddingTop: '1rem',
    borderTop: '1px solid var(--border)',
  },
  helpTitle: { margin: '0 0 0.5rem', fontSize: '1.05rem' },
  helpText: { margin: '0 0 0.5rem', color: 'var(--text-sub)' },
  helpList: { margin: '0 0 0.5rem', paddingLeft: '1.25rem' },
} as const satisfies Record<string, React.CSSProperties>;
