/**
 * ログイン状態の保持（要件定義書 2.3 / D-54）。
 *
 * トークンは **このモジュールのメモリ上にだけ** 置く。
 * IndexedDB にも localStorage にも書かない。アプリを閉じれば消える。
 */

import { log } from '../lib/log';
import { AuthError, requestToken, revokeToken, type TokenResult } from './tokenClient';

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
    const token = await requestToken('');
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

/** ログアウト。トークンを無効化してメモリから消す。 */
export async function signOut(): Promise<void> {
  const token = current;
  setCurrent(null);
  if (token) {
    try {
      await revokeToken(token.accessToken);
    } catch (e) {
      // 無効化に失敗しても手元からは消えている。1時間で自然に失効する。
      log.warn('トークンの無効化に失敗', e);
    }
  }
}

export { AuthError, type TokenResult };
