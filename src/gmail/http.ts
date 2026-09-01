/**
 * Gmail API を呼ぶための薄い fetch ラッパ。
 *
 * gapi は使わない。外部スクリプトを GIS の1本に留めるため（要件定義書 6.2）。
 * エラー処理は 6.3 に従う。オフラインの検出、401 でのトークン取り直し、
 * 429 / 5xx / 通信断の指数バックオフをここで一手に引き受け、
 * 呼び出し側は GmailError の userMessage をそのまま出せばよいようにする。
 */

import { GMAIL_API_BASE } from '../config';
import { ensureAccessToken, forceRefresh } from '../auth/session';
import { log } from '../lib/log';

export type GmailErrorKind =
  /** トークンが無効。取り直しても駄目だった。 */
  | 'unauthorized'
  /** スコープ不足。403 Insufficient Permission。 */
  | 'forbidden'
  | 'not_found'
  /** 短時間に呼びすぎ。 */
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'unknown';

export class GmailError extends Error {
  constructor(
    readonly kind: GmailErrorKind,
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'GmailError';
  }

  /** 5.4 / 6.3 に従い「次に何をすればよいか」を含む文面。 */
  get userMessage(): string {
    switch (this.kind) {
      case 'unauthorized':
        return 'Googleへのログインが切れました。もう一度ログインしてください。';
      case 'forbidden':
        return 'Gmailを操作する許可が足りません。もう一度ログインして、確認画面ですべてにチェックを入れてください。';
      case 'rate_limited':
        return '短い時間に何度もやり取りしました。少し待ってから、もう一度お試しください。';
      case 'network':
        return 'インターネットに繋がっていないようです。繋がってから、もう一度お試しください。';
      case 'server':
        return 'Google側で一時的な問題が起きています。時間をおいてもう一度お試しください。';
      default:
        return 'うまくいきませんでした。時間をおいてもう一度お試しください。';
    }
  }
}

function kindOf(status: number): GmailErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

type GoogleErrorBody = {
  error?: { code?: number; message?: string; status?: string };
};

async function readError(response: Response): Promise<{ message: string; body: unknown }> {
  let body: unknown = null;
  let message = `${response.status} ${response.statusText}`;
  try {
    body = await response.json();
    const m = (body as GoogleErrorBody).error?.message;
    if (m) message = m;
  } catch {
    // JSON でない応答はそのまま status を使う
  }
  return { message, body };
}

export type GmailRequest = {
  /** `/users/me/...` の形。GMAIL_API_BASE からの相対。 */
  path: string;
  method?: 'GET' | 'POST';
  query?: Record<string, string | undefined>;
  body?: unknown;
};

/** 再試行の設定（要件定義書 6.3: 指数バックオフで最大3回）。 */
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 待ち時間。回を追うごとに倍にし、揺らぎを足して同時再送が重ならないようにする。 */
function backoffDelay(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt + Math.random() * 200;
}

/**
 * Gmail API を呼ぶ。
 *
 * - オフラインなら通信せずに落とす（6.3）
 * - 401 はトークンを取り直して1回だけ再送する
 * - 429 / 5xx / 通信断は指数バックオフで最大3回まで再試行する（6.3）
 * - 4xx（401 以外）は再試行しない。何度呼んでも同じ結果になるため
 */
export async function gmailFetch<T>(request: GmailRequest): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new GmailError('network', 0, 'オフラインです');
  }

  let lastError: GmailError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(backoffDelay(attempt - 1));

    try {
      const token = await ensureAccessToken();
      let response = await send(request, token);

      if (response.status === 401) {
        log.debug('401。トークンを取り直して再送する');
        const fresh = await forceRefresh();
        response = await send(request, fresh);
      }

      if (response.ok) return (await response.json()) as T;

      const { message, body } = await readError(response);
      const error = new GmailError(kindOf(response.status), response.status, message, body);
      if (!isRetryable(error)) throw error;
      lastError = error;
      log.warn(`再試行します（${attempt + 1}/${MAX_ATTEMPTS}）`, error.status, error.message);
    } catch (e) {
      if (!(e instanceof GmailError)) throw e;
      if (!isRetryable(e)) throw e;
      lastError = e;
      log.warn(`再試行します（${attempt + 1}/${MAX_ATTEMPTS}）`, e.status, e.message);
    }
  }

  throw lastError ?? new GmailError('unknown', 0, '呼び出しに失敗しました');
}

function isRetryable(error: GmailError): boolean {
  return error.kind === 'rate_limited' || error.kind === 'server' || error.kind === 'network';
}

async function send(request: GmailRequest, accessToken: string): Promise<Response> {
  const url = new URL(GMAIL_API_BASE + request.path);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    return await fetch(url, {
      method: request.method ?? 'GET',
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
  } catch (e) {
    throw new GmailError('network', 0, 'ネットワークに到達できませんでした', e);
  }
}

