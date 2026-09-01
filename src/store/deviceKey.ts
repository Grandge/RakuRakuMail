/**
 * Device Key の取り回し（要件定義書 4.3 第1段階 / D-49）。
 *
 * 鍵は端末ごとに1本。利用者に入力させるものは何も無い（NFR-01）。
 * 一度作った鍵は保管庫に置き、次回以降はそれを使い回す。
 *
 * このファイルは IndexedDB を知らない。保管庫を `KeyVault` として受け取り、
 * 「無ければ作る」という判断だけを持つので、単体テストできる。
 */

import { createDeviceKey } from './crypto';
import { log } from '../lib/log';

/** 鍵の置き場。実体は store/db.ts が IndexedDB で用意する。 */
export type KeyVault = {
  read(): Promise<CryptoKey | undefined>;
  write(key: CryptoKey): Promise<void>;
};

/**
 * 保管庫にある鍵を返す。無ければ作って保管してから返す。
 *
 * 保管に失敗しても作った鍵はそのまま返す。保存が効かない環境
 * （プライベートウィンドウなど）でも、その回のセッションは動かすため。
 */
export async function loadOrCreateDeviceKey(vault: KeyVault): Promise<CryptoKey> {
  const existing = await vault.read();
  if (existing) return existing;

  const created = await createDeviceKey();
  try {
    await vault.write(created);
  } catch (e) {
    log.warn('鍵を保管できませんでした。次回は設定を読み直せません', e);
  }
  return created;
}
