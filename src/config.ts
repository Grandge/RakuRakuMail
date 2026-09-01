/** アプリ全体の定数。値の根拠は 要件定義書 の該当節を併記する。 */

/** OAuth クライアント ID（M1実装計画 Step 0-6）。 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

/**
 * 要求するスコープ（要件定義書 2.4）。
 *
 * 必須と任意に分けるのは、同意画面でスコープごとにチェックを外せる
 * （granular consent）ため。任意のものを外されてもログインは通す。
 *
 * - gmail.modify … メールの読み書き。これが無ければ何もできない。
 *   messages.send が含まれるかは Step 3 で検証する（9章 未確定事項1）
 * - userinfo.profile … Google アカウントの名前。表示名の自動取得にだけ使う（NFR-01）。
 *   非機密スコープ。外されても .env.local の既定値か手入力に落ちるだけ
 */
export const REQUIRED_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'] as const;

export const OPTIONAL_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

export const SCOPES: readonly string[] = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES];

/** Google アカウントの名前を読む OpenID Connect のエンドポイント。 */
export const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** 目印文字列（要件定義書 3.1 / D-17）。ハイフンを含めない。 */
export const MARKER = 'rakurakumail';
export const MARKER_REACTION = 'rakurakureact';

/** 本文フッタ（要件定義書 3.2 / D-15）。 */
export const FOOTER_SEPARATOR = '--';
export const FOOTER_TEXT = `らくらくメール ${MARKER} より送信`;

/** 独自ヘッダの形式の版数（要件定義書 3.3）。 */
export const RAKURAKU_VERSION = '1';

/** アプリ名。件名の先頭に付く（要件定義書 3.4 / D-59）。 */
export const APP_NAME = 'らくらくメール';

/** Gmail API のベースURL。 */
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

/**
 * 開発中の既定値。入力欄の初期値と、自動取得できなかったときの保険にだけ使う。
 * 本来の表示名は Gmail の sendAs から自動取得する（gmail/profile.ts）。
 */
export const DEV_DISPLAY_NAME: string = import.meta.env.VITE_DEV_DISPLAY_NAME ?? '';
export const DEV_PEER_EMAIL: string = import.meta.env.VITE_DEV_PEER_EMAIL ?? '';
