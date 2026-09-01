/**
 * ログイン状態の保持（要件定義書 2.3 / D-54）。
 *
 * トークンは **このモジュールのメモリ上にだけ** 置く。
 * IndexedDB にも localStorage にも書かない。アプリを閉じれば消える。
 */

import { log } from '../lib/log';
import { AuthError, requestToken, type TokenResult } from './tokenClient';

/** 失効の何ミリ秒前から取り直すか。 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let current: TokenResult | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

function setCurrent(next: TokenResult | null): void {
  current = next;
  notify();
}

/** React の useSyncExternalStore 用。 */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 参照は同一性が保たれる（未ログインなら常に null）。 */
export function getSnapshot(): TokenResult | null {
  return current;
}

function isUsable(token: TokenResult | null): token is TokenResult {
  return token !== null && token.expiresAt - Date.now() > REFRESH_MARGIN_MS;
}

export function isSignedIn(): boolean {
  return isUsable(current);
}

/**
 * 起動時に画面を出さずに取得を試みる（要件定義書 2.3 手順1）。
 * 失敗しても例外にせず null を返す。呼び出し側はログイン画面を出す。
 */
export async function trySilentSignIn(): Promise<TokenResult | null> {
  try {
    // background: true … ボタンから始まった取得をこの試みに相乗りさせない。
    // 相乗りさせると、ここでポップアップを塞がれた失敗をボタンの1回目が
    // 引き継いでしまう（tokenClient.ts の RequestOptions を参照）。
    const token = await requestToken('', { background: true });
    setCurrent(token);
    return token;
  } catch (e) {
    log.debug('裏でのトークン取得は失敗（ログイン画面へ誘導する）', e);
    return null;
  }
}

/**
 * 利用者の操作（ボタンのクリック）から呼ぶ（要件定義書 2.3 手順3）。
 * ポップアップが塞がれないよう、必ずクリックハンドラの中から呼ぶこと。
 */
export async function signIn(): Promise<TokenResult> {
  const token = await requestToken('');
  setCurrent(token);
  return token;
}

/**
 * API を呼ぶ直前に使う。期限が近ければ黙って取り直す（要件定義書 2.3 手順5）。
 * 取り直しもポップアップ経由なので塞がれうる。その場合は AuthError が飛ぶので、
 * 呼び出し側はログイン画面へ戻すこと（6.3）。
 */
export async function ensureAccessToken(): Promise<string> {
  if (isUsable(current)) return current.accessToken;

  const token = await requestToken('');
  setCurrent(token);
  return token.accessToken;
}

/** 401 を受けたときに使う。手元のトークンを捨てて必ず取り直す。 */
export async function forceRefresh(): Promise<string> {
  setCurrent(null);
  const token = await requestToken('');
  setCurrent(token);
  return token.accessToken;
}

/**
 * ログアウト。メモリ上のトークンを捨てるだけにする。
 *
 * ここで `revokeToken()` を呼ばないのは意図的（要件定義書 6.2 / D-54, D-55）。
 * 呼ぶと許可が中途半端に取り消され、次のログインで Google が増分同意
 * （「すでに一部のアクセス権限を付与されています」）の画面を出す。すると
 * 1回目はスコープが揃わず `scope_denied` になり、2回目でようやく通る。
 * 高齢者やITが苦手な人が使う前提（NFR-01）では重すぎる。
 *
 * トークンはメモリ上にしかない（D-54）ので、捨てた時点でこのアプリからは
 * 使えず、ログアウトとして成立する。残ったトークン自体も1時間で失効する。
 *
 * 許可そのものの取り消しは `revokeToken()` を使い、S-07 設定画面の
 * 「この端末のデータを消す」から `clearAll()` と一緒に行う（要件定義書 6.2）。
 *
 * なお、端末に保存したデータはログアウトでは消さない（6.2 / 5.4 / D-55）。
 */
export function signOut(): void {
  setCurrent(null);
  log.debug('ログアウト（メモリ上のトークンを破棄）');
}

export { AuthError, type TokenResult };
