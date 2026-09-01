/**
 * 設定データの暗号化（要件定義書 4.3 第1段階 / D-49 / PER-02）。
 *
 * AES-GCM。鍵は **取り出せない CryptoKey**（extractable: false）を使う。
 * JavaScript から鍵素材を取り出せないので、ページ上で悪意あるスクリプトが
 * 動いても鍵そのものは持ち出せない（使うことはできる。6.2 の脅威の表を参照）。
 *
 * このファイルは IndexedDB を知らない。鍵を受け取って変換するだけの
 * 純粋な処理にして、単体テストできるようにする。
 */

const ALGORITHM = 'AES-GCM';

/** GCM の初期化ベクトルは12バイトが推奨。毎回新しく作る。 */
const IV_LENGTH = 12;

/**
 * 暗号化した1件。IndexedDB にはこの形で入れる。
 *
 * `Uint8Array<ArrayBuffer>` と書いているのは、既定の `Uint8Array` が
 * `SharedArrayBuffer` の可能性を含み、WebCrypto の `BufferSource` に渡せないため。
 */
export type Encrypted = {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
};

/** 取り出せない鍵を新しく作る。利用者の入力操作は不要（NFR-01）。 */
export async function createDeviceKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey({ name: ALGORITHM, length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<Encrypted> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext);
  return { iv, data };
}

/**
 * 復号する。鍵が違う・データが壊れている場合は null を返す。
 * 例外にしないのは、壊れた保存データでアプリが起動できなくなるのを避けるため。
 */
export async function decryptJson<T>(
  key: CryptoKey,
  encrypted: Encrypted,
): Promise<T | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: encrypted.iv },
      key,
      encrypted.data,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}
