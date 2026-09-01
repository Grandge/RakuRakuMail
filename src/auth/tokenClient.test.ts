/**
 * `requestToken` の同時実行まわり。
 *
 * 直したのは2つ。
 * 1. コールバックを要求ごとに閉じ込める（クライアントを使い回さない）。
 *    使い回すと、片付いた古い要求のコールバックが次の要求を落とす。
 * 2. 利用者の操作から始まった取得を、裏の取得に相乗りさせない。
 *    相乗りすると、塞がれた裏の取得の失敗をボタンの1回目が引き継ぐ。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
}));

vi.mock('./gisLoader', () => ({
  whenGisReady: () => Promise.resolve(),
}));

type Handlers = {
  callback: (response: Record<string, unknown>) => void;
  error_callback: (error: Record<string, unknown>) => void;
};

/** 作られた TokenClient を1つずつ記録する、GIS の身代わり。 */
type FakeClient = Handlers & { requested: { prompt?: string; hint?: string }[] };

let clients: FakeClient[] = [];

function installFakeGis(): void {
  clients = [];
  const oauth2 = {
    initTokenClient(config: Handlers & Record<string, unknown>) {
      const client: FakeClient = {
        callback: config.callback,
        error_callback: config.error_callback,
        requested: [],
      };
      clients.push(client);
      return {
        requestAccessToken(options: { prompt?: string; hint?: string }) {
          client.requested.push(options);
        },
      };
    },
    revoke(_token: string, done: () => void) {
      done();
    },
  };
  (globalThis as { window?: unknown }).window = { google: { accounts: { oauth2 } } };
}

/** 保留中の Promise を進める。 */
const tick = () => new Promise((r) => setTimeout(r, 0));

const OK = {
  access_token: 'token-value',
  expires_in: '3599',
  scope: 'https://www.googleapis.com/auth/gmail.modify',
};

let requestToken: typeof import('./tokenClient').requestToken;
let AuthError: typeof import('./tokenClient').AuthError;

beforeEach(async () => {
  installFakeGis();
  // モジュール変数（inFlight）をテストごとに捨てる。
  vi.resetModules();
  const mod = await import('./tokenClient');
  requestToken = mod.requestToken;
  AuthError = mod.AuthError;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('requestToken', () => {
  it('トークンを組み立てて返す', async () => {
    const promise = requestToken('');
    await tick();
    clients[0]?.callback(OK);

    const token = await promise;
    expect(token.accessToken).toBe('token-value');
    expect(token.grantedScopes).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it('必須スコープが外されたら scope_denied にする', async () => {
    const promise = requestToken('');
    await tick();
    clients[0]?.callback({ ...OK, scope: 'https://www.googleapis.com/auth/userinfo.profile' });

    await expect(promise).rejects.toMatchObject({ kind: 'scope_denied' });
  });

  it('裏の取得どうしは1本にまとめる（ポップアップを2つ開かない）', async () => {
    const a = requestToken('', { background: true });
    const b = requestToken('', { background: true });
    await tick();

    expect(clients).toHaveLength(1);
    clients[0]?.callback(OK);
    expect((await a).accessToken).toBe((await b).accessToken);
  });

  it('利用者の操作から始まった取得は、裏の取得に相乗りしない', async () => {
    // 起動直後の裏の取得。ポップアップを塞がれる。
    const silent = requestToken('', { background: true });
    await tick();
    expect(clients).toHaveLength(1);

    // まだ片付かないうちにボタンが押された。
    const clicked = requestToken('');
    await tick();
    expect(clients).toHaveLength(2);

    // 裏の取得が塞がれても、ボタンの方は巻き込まれない。
    clients[0]?.error_callback({ type: 'popup_failed_to_open' });
    await expect(silent).rejects.toMatchObject({ kind: 'popup_blocked' });

    clients[1]?.callback(OK);
    await expect(clicked).resolves.toMatchObject({ accessToken: 'token-value' });
  });

  it('片付いた要求のコールバックが、次の要求を落とさない', async () => {
    const first = requestToken('');
    await tick();
    clients[0]?.error_callback({ type: 'popup_closed' });
    await expect(first).rejects.toBeInstanceOf(AuthError);

    const second = requestToken('');
    await tick();
    expect(clients).toHaveLength(2);

    // 1本目の遅れて届いたコールバック。2本目に触ってはいけない。
    clients[0]?.error_callback({ type: 'popup_failed_to_open' });
    clients[0]?.callback({ error: 'access_denied' });

    clients[1]?.callback(OK);
    await expect(second).resolves.toMatchObject({ accessToken: 'token-value' });
  });

  it('同じ要求にコールバックが二度来ても、最初の結果を保つ', async () => {
    const promise = requestToken('');
    await tick();
    clients[0]?.callback(OK);
    clients[0]?.callback({ error: 'access_denied' });

    await expect(promise).resolves.toMatchObject({ accessToken: 'token-value' });
  });

  it('hint を渡すと requestAccessToken に載る', async () => {
    const promise = requestToken('select_account', { hint: 'taro@example.com' });
    await tick();
    expect(clients[0]?.requested[0]).toEqual({
      prompt: 'select_account',
      hint: 'taro@example.com',
    });
    clients[0]?.callback(OK);
    await promise;
  });

  it('取得が終われば、次の裏の取得は新しく始まる', async () => {
    const first = requestToken('', { background: true });
    await tick();
    clients[0]?.callback(OK);
    await first;

    const second = requestToken('', { background: true });
    await tick();
    expect(clients).toHaveLength(2);
    clients[1]?.callback(OK);
    await second;
  });
});
