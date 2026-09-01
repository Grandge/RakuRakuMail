/**
 * 自分のアドレスと表示名の自動取得。
 *
 * 利用者に入力させずに済ませるため（NFR-01）、Google から読み取る。
 *
 * - アドレス … `users.getProfile` の `emailAddress`
 * - 表示名   … 次の順に試す
 *   1. `users.settings.sendAs.list` の主アドレスの `displayName`
 *      Gmail が送信時に From へ入れている名前そのもの。最も正確
 *   2. OpenID Connect の userinfo の `name`（Google アカウントの名前）
 *      sendAs が空のとき、Gmail が実際に使うのはこちら
 *   3. 取れなければ null。呼び出し側で既定値か手入力に落とす
 *
 * [検証済み 2026-09-01] sendAs の *読み取り* は gmail.modify に含まれる。
 */

import { USERINFO_ENDPOINT } from '../config';
import { ensureAccessToken } from '../auth/session';
import { log } from '../lib/log';
import { GmailError, gmailFetch } from './http';

type GetProfileResponse = {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
};

type SendAsEntry = {
  sendAsEmail: string;
  displayName?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
};

type SendAsListResponse = {
  sendAs?: SendAsEntry[];
};

type UserInfoResponse = {
  name?: string;
  given_name?: string;
  family_name?: string;
};

/** 表示名をどこから得たか。取れなかった場合は理由で分ける。 */
export type DisplayNameSource =
  /** Gmail の送信者名（sendAs.displayName）。 */
  | 'sendAs'
  /** Google アカウントの名前（userinfo.name）。 */
  | 'account'
  /** どちらも取れなかった。 */
  | 'none';

export type MyProfile = {
  email: string;
  /** 取得できなければ null。呼び出し側で既定値か手入力に落とす。 */
  displayName: string | null;
  displayNameSource: DisplayNameSource;
  /** 経緯の説明（開発時の切り分け用）。 */
  displayNameDetail?: string;
};

/** 自分のメールアドレスを取得する。 */
export async function getEmailAddress(): Promise<string> {
  const profile = await gmailFetch<GetProfileResponse>({ path: '/users/me/profile' });
  return profile.emailAddress;
}

/** Gmail の送信者名。設定されていなければ null。 */
async function fetchSendAsName(email: string): Promise<{ name: string | null; note: string }> {
  try {
    const list = await gmailFetch<SendAsListResponse>({ path: '/users/me/settings/sendAs' });
    const entries = list.sendAs ?? [];

    // 主アドレスを優先し、無ければアドレス一致、それも無ければ既定のもの。
    const primary =
      entries.find((e) => e.isPrimary === true) ??
      entries.find((e) => e.sendAsEmail.toLowerCase() === email.toLowerCase()) ??
      entries.find((e) => e.isDefault === true);

    const name = primary?.displayName?.trim();
    if (name) return { name, note: '' };
    return { name: null, note: `sendAs は ${entries.length} 件読めたが displayName が空` };
  } catch (e) {
    if (e instanceof GmailError) {
      log.warn('sendAs を読めなかった', e.status, e.message);
      return { name: null, note: `sendAs の取得に失敗（${e.status}）` };
    }
    throw e;
  }
}

/** Google アカウントの名前。userinfo.profile が許可されていなければ null。 */
async function fetchAccountName(): Promise<{ name: string | null; note: string }> {
  try {
    const token = await ensureAccessToken();
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      // 401/403 は userinfo.profile が許可されなかった場合。致命的ではない。
      log.warn('userinfo を読めなかった', response.status);
      return { name: null, note: `アカウント名の取得に失敗（${response.status}）` };
    }
    const info = (await response.json()) as UserInfoResponse;
    const name =
      info.name?.trim() ||
      [info.family_name, info.given_name].filter(Boolean).join(' ').trim();
    if (name) return { name, note: '' };
    return { name: null, note: 'アカウント名が空' };
  } catch (e) {
    log.warn('userinfo の取得で例外', e);
    return { name: null, note: 'アカウント名の取得に失敗' };
  }
}

/**
 * 自分のアドレスと表示名をまとめて取得する。
 * 表示名が取れなくてもアドレスは返す（表示名は null になる）。
 */
export async function fetchMyProfile(): Promise<MyProfile> {
  const email = await getEmailAddress();

  const sendAs = await fetchSendAsName(email);
  if (sendAs.name) {
    return { email, displayName: sendAs.name, displayNameSource: 'sendAs' };
  }

  const account = await fetchAccountName();
  if (account.name) {
    return {
      email,
      displayName: account.name,
      displayNameSource: 'account',
      displayNameDetail: sendAs.note,
    };
  }

  return {
    email,
    displayName: null,
    displayNameSource: 'none',
    displayNameDetail: [sendAs.note, account.note].filter(Boolean).join(' / '),
  };
}
