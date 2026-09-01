/**
 * GIS のトークンクライアント（要件定義書 2.3 / D-09）。
 *
 * サーバーが無いためリフレッシュトークンは発行されない。
 * 期限が切れたら同じ手順で取り直す。
 */

import { GOOGLE_CLIENT_ID, REQUIRED_SCOPES, SCOPES } from '../config';
import { log } from '../lib/log';
import { whenGisReady } from './gisLoader';

/** 取得できたトークン。永続化しない（D-54）。 */
export type TokenResult = {
  readonly accessToken: string;
  /** 失効時刻（epoch ミリ秒）。 */
  readonly expiresAt: number;
  /** 実際に許可されたスコープ。要求と一致しないことがある。 */
  readonly grantedScopes: readonly string[];
};

export type AuthErrorKind =
  /** GIS のスクリプトを読み込めなかった。 */
  | 'gis_unavailable'
  /** ポップアップがブラウザに塞がれた。利用者の操作から呼び直せば通る。 */
  | 'popup_blocked'
  /** 利用者が同意画面を閉じた・拒否した。 */
  | 'cancelled'
  /** 必要なスコープが許可されなかった。 */
  | 'scope_denied'
  | 'unknown';

export class AuthError extends Error {
  constructor(
    readonly kind: AuthErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthError';
  }

  /** 5.4 に従い、利用者に見せる文面は「次に何をすればよいか」を含める。 */
  get userMessage(): string {
    switch (this.kind) {
      case 'gis_unavailable':
        return 'Googleのログイン機能を読み込めませんでした。インターネットに繋がっているか確認して、画面を更新してください。';
      case 'popup_blocked':
        return 'Googleのログイン画面を開けませんでした。下の「Googleでログイン」を押してください。';
      case 'cancelled':
        return 'ログインが完了しませんでした。もう一度「Googleでログイン」を押してください。';
      case 'scope_denied':
        return 'メールを読み書きする許可が得られませんでした。もう一度ログインして、確認画面ですべてにチェックを入れてください。';
      default:
        return 'ログインできませんでした。少し時間をおいて、もう一度お試しください。';
    }
  }
}

/** `prompt` に渡せる値（GIS の仕様）。 */
export type PromptMode = '' | 'none' | 'consent' | 'select_account';

export type RequestOptions = {
  /** アカウントを指定する（M3 の切り替えで使う）。 */
  readonly hint?: string;
  /**
   * **利用者の操作を伴わない裏の取得か。**
   *
   * 裏の取得どうしは1本にまとめてよい。しかし利用者がボタンを押して始めた
   * 取得を、進行中の裏の取得に相乗りさせてはいけない。裏の取得はポップアップを
   * 塞がれて失敗することがあり（要件定義書 2.3 手順1）、相乗りするとその失敗を
   * ボタンの1回目が引き継いで「1回目だけ失敗して2回目は通る」ことになる。
   */
  readonly background?: boolean;
};

/** いま進行中の取得。裏の取得を相乗りさせる先。 */
let inFlight: Promise<TokenResult> | null = null;

async function ensureReady(): Promise<void> {
  try {
    await whenGisReady();
  } catch (e) {
    throw new AuthError('gis_unavailable', 'GIS を読み込めませんでした', e);
  }

  if (!GOOGLE_CLIENT_ID) {
    throw new AuthError(
      'unknown',
      'クライアントIDが未設定です（.env.local の VITE_GOOGLE_CLIENT_ID）',
    );
  }
}

/**
 * 取得を1回だけ行う。
 *
 * **`initTokenClient` を要求ごとに作る。** GIS のコールバックはクライアントに
 * 1組しか登録できないため、クライアントを使い回すと、片付いたはずの古い要求の
 * コールバックが次の要求を解決・棄却してしまう。要求ごとに作れば、
 * コールバックはその要求の `resolve` / `reject` だけを閉じ込める。
 * `settled` の番人は、同じ要求に対してコールバックが二度来ても効くようにするため。
 */
async function requestOnce(prompt: PromptMode, hint?: string): Promise<TokenResult> {
  await ensureReady();

  return await new Promise<TokenResult>((resolve, reject) => {
    let settled = false;

    const ok = (result: TokenResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const ng = (error: AuthError): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES.join(' '),
      callback: (response) => {
        if (response.error) {
          log.warn('トークン取得に失敗', response.error, response.error_description);
          ng(
            new AuthError(
              response.error === 'access_denied' ? 'cancelled' : 'unknown',
              response.error_description || response.error,
            ),
          );
          return;
        }

        const granted = (response.scope ?? '').split(' ').filter(Boolean);
        // 任意スコープを外されてもログインは通す。必須のものだけを見る。
        const missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s));
        if (missing.length > 0) {
          ng(new AuthError('scope_denied', `許可されなかったスコープ: ${missing.join(', ')}`));
          return;
        }

        ok({
          accessToken: response.access_token,
          // expires_in は秒。安全側に倒して現在時刻を起点にする。
          expiresAt: Date.now() + Number(response.expires_in) * 1000,
          grantedScopes: granted,
        });
      },
      error_callback: (error) => {
        // popup_failed_to_open … 利用者操作を伴わない呼び出しが塞がれた
        // popup_closed        … 利用者が同意画面を閉じた
        const type = String(error.type ?? '');
        log.warn('トークン取得のエラー', type, error.message);
        ng(
          type === 'popup_failed_to_open'
            ? new AuthError('popup_blocked', 'ポップアップが開けませんでした', error)
            : type === 'popup_closed'
              ? new AuthError('cancelled', 'ログイン画面が閉じられました', error)
              : new AuthError('unknown', error.message ?? type, error),
        );
      },
    });

    client.requestAccessToken(hint === undefined ? { prompt } : { prompt, hint });
  });
}

/**
 * トークンを1つ取得する。
 *
 * `prompt: ''` は「初回だけ同意画面を出し、以降は黙って取り直す」の意味。
 * ただし GIS はトークンモデルでも内部でポップアップを開くため、
 * 利用者の操作を伴わない起動直後の呼び出しは塞がれうる（AuthError('popup_blocked')）。
 * 呼び出し側はその場合にボタンを出し、クリックから呼び直すこと（要件定義書 2.3 手順3）。
 *
 * `options.background` の扱いは {@link RequestOptions} を参照。既定は
 * 「利用者の操作から始まった取得」で、進行中のものには相乗りせず必ず自分で取りにいく。
 * ここで `await` を挟まずに `requestAccessToken` へ届くようにしてあるのは、
 * クリックの操作履歴（transient user activation）を失わないため。
 */
export function requestToken(
  prompt: PromptMode = '',
  options: RequestOptions = {},
): Promise<TokenResult> {
  // 裏の取得どうしは1本にまとめる。GIS は同時に複数の要求を捌けない。
  if (options.background === true && inFlight !== null) return inFlight;

  const promise = requestOnce(prompt, options.hint);
  inFlight = promise;

  // 後から始まった取得に追い越されている場合は、その参照を消さない。
  const forget = (): void => {
    if (inFlight === promise) inFlight = null;
  };
  promise.then(forget, forget);

  return promise;
}

/**
 * アクセストークンを無効化し、このアプリへの許可を取り消す。
 *
 * **ログアウトでは呼ばない**（`session.ts` の `signOut()` を参照）。呼ぶ場所は
 * S-07 設定画面の「この端末のデータを消す」だけで、`db.clearAll()` と一緒に
 * 使う（要件定義書 6.2 / D-55）。M1 時点では S-07 が未実装のため、この関数は
 * まだどこからも呼ばれていない。
 */
export function revokeToken(accessToken: string): Promise<void> {
  return new Promise((resolve) => {
    if (!window.google?.accounts?.oauth2?.revoke) {
      resolve();
      return;
    }
    window.google.accounts.oauth2.revoke(accessToken, () => resolve());
  });
}
