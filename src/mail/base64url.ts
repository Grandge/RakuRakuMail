/**
 * base64 / base64url とバイト列・UTF-8文字列の変換。
 *
 * ここが狂うと本文も件名も独自ヘッダも全部化けるので、
 * この層は Gmail API を一切知らない純粋関数だけにして単体テストで固める。
 *
 * 注意:
 * - `btoa` は Latin-1 しか扱えない。日本語は必ず TextEncoder でバイト列にしてから渡す
 * - Gmail API の `raw` は **base64url**（`+`→`-`、`/`→`_`、末尾の `=` を落とす）
 * - MIME 本文の Content-Transfer-Encoding: base64 は **標準の base64**（`+` `/` `=` を使う）
 */

/** 一度に String.fromCharCode へ渡す上限。大きすぎるとスタックが溢れる。 */
const CHUNK = 0x8000;

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

/** 標準の base64（MIME 本文用）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

export function base64ToBytes(base64: string): Uint8Array {
  return binaryToBytes(atob(base64));
}

/** base64url（Gmail API の `raw` と独自ヘッダ用）。 */
export function bytesToBase64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(base64url: string): Uint8Array {
  const normalized = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // 4の倍数になるまで `=` を補う。
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return base64ToBytes(padded);
}

/** UTF-8 文字列 ⇔ base64url。 */
export function encodeBase64url(text: string): string {
  return bytesToBase64url(utf8ToBytes(text));
}

export function decodeBase64url(base64url: string): string {
  return bytesToUtf8(base64urlToBytes(base64url));
}

/**
 * base64 を1行あたり `width` 文字で折り返す（RFC 2045 は76文字以下を要求）。
 * 改行は CRLF。
 */
export function wrapBase64(base64: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += width) {
    lines.push(base64.slice(i, i + width));
  }
  return lines.join('\r\n');
}
