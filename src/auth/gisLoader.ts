/**
 * Google Identity Services（GIS）の読み込み待ち。
 *
 * スクリプトの読み込み自体は index.html の <script async> で行う。
 * ここで動的に <script> を足さないのは、CSP で許可した1本以外を
 * 走らせない方針（要件定義書 6.2）を守るため。
 */

const READY_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 50;

let readyPromise: Promise<void> | null = null;

function isLoaded(): boolean {
  return typeof window.google?.accounts?.oauth2?.initTokenClient === 'function';
}

/** GIS が使えるようになるまで待つ。読み込めなければ reject する。 */
export function whenGisReady(): Promise<void> {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    if (isLoaded()) {
      resolve();
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (isLoaded()) {
        window.clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > READY_TIMEOUT_MS) {
        window.clearInterval(timer);
        // 一度失敗しても再読み込み後に成功しうるので、状態を残さない。
        readyPromise = null;
        reject(new Error('gis_unavailable'));
      }
    }, POLL_INTERVAL_MS);
  });

  return readyPromise;
}
