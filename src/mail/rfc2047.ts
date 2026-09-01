/**
 * メールヘッダの日本語を扱う（RFC 2047）。
 *
 * メールヘッダはASCIIしか通らない。件名（3.4）と差出人の表示名は
 * `=?UTF-8?B?<base64>?=` の形（encoded-word）にして入れる。
 *
 * 決まりごと:
 * - encoded-word 1つの全長は75文字以下（RFC 2047 §2）
 * - マルチバイト文字を encoded-word の境界で切ってはいけない（§5）
 * - 長い場合は複数の encoded-word に分け、CRLF＋空白で折り返す（folding）
 * - 復号時、隣り合う encoded-word の間の空白は取り除く
 */

import { base64ToBytes, bytesToBase64, utf8ToBytes } from './base64url';

const PREFIX = '=?UTF-8?B?';
const SUFFIX = '?=';

/**
 * encoded-word 1つに詰められる元データのバイト数。
 * 75 - (前置10 + 後置2) = 63文字のbase64が上限。
 * base64は4文字単位なので60文字＝45バイトまで。
 */
const MAX_BYTES_PER_WORD = 45;

/** ASCII の印字可能文字だけで、特別な意味を持つ文字を含まないか。 */
function isPlainAscii(text: string): boolean {
  // 制御文字と非ASCIIは不可。encoded-word の開始に見える "=?" も避ける。
  return /^[\x20-\x7e]*$/.test(text) && !text.includes('=?');
}

/** 文字境界を守りながら、UTF-8で maxBytes 以下になる塊に切る。 */
function splitByByteLength(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let buffer = '';
  let bytes = 0;

  // サロゲートペアを壊さないよう、コードポイント単位で回す。
  for (const ch of text) {
    const size = utf8ToBytes(ch).length;
    if (bytes + size > maxBytes && buffer !== '') {
      chunks.push(buffer);
      buffer = '';
      bytes = 0;
    }
    buffer += ch;
    bytes += size;
  }
  if (buffer !== '') chunks.push(buffer);
  return chunks;
}

/**
 * ヘッダの値を encoded-word にする。
 * ASCII だけなら符号化せずそのまま返す（相手のメールソフトで素直に読めるため）。
 */
export function encodeWord(text: string): string {
  if (text === '') return '';
  if (isPlainAscii(text)) return text;

  return splitByByteLength(text, MAX_BYTES_PER_WORD)
    .map((chunk) => PREFIX + bytesToBase64(utf8ToBytes(chunk)) + SUFFIX)
    .join('\r\n '); // 継続行は空白始まりにする（folding）
}

/** ローカル部・ドメインに使えない文字が含まれていないかの簡易確認。 */
const EMAIL_PATTERN = /^[^\s<>@,;:"]+@[^\s<>@,;:"]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/**
 * `From` / `To` に入れるアドレス表記を組み立てる。
 * 表示名が空なら `<addr>` だけを返す。
 */
export function formatAddress(email: string, displayName?: string): string {
  const name = displayName?.trim() ?? '';
  if (name === '') return `<${email}>`;

  if (isPlainAscii(name)) {
    // ASCII でも `.` や `,` は quoted-string にしないと解釈がぶれる。
    return `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>`;
  }
  return `${encodeWord(name)} <${email}>`;
}

/** `=?UTF-8?B?...?=` を含むヘッダ値を元の文字列に戻す。 */
export function decodeWords(value: string): string {
  // まず encoded-word の間の折り返し（CRLF＋空白）を畳む。
  const unfolded = value.replace(/\r?\n[ \t]+/g, ' ');

  const pattern = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
  let result = '';
  let lastIndex = 0;
  let previousWasWord = false;

  for (const match of unfolded.matchAll(pattern)) {
    const start = match.index;
    const between = unfolded.slice(lastIndex, start);

    // 隣り合う encoded-word の間の空白だけは取り除く（RFC 2047 §6.2）。
    if (!(previousWasWord && between.trim() === '')) {
      result += between;
    }

    const [, charset = 'UTF-8', encoding = 'B', payload = ''] = match;
    result += decodePayload(payload, encoding, charset);

    lastIndex = start + match[0].length;
    previousWasWord = true;
  }

  result += unfolded.slice(lastIndex);
  return result;
}

function decodePayload(payload: string, encoding: string, charset: string): string {
  try {
    const bytes =
      encoding.toUpperCase() === 'B'
        ? base64ToBytes(payload)
        : decodeQEncoding(payload);
    // UTF-8 以外（ISO-2022-JP など）も TextDecoder に任せる。
    return new TextDecoder(normalizeCharset(charset)).decode(bytes);
  } catch {
    // 読めない符号化はそのまま出す。落とすよりは元の文字列を見せる方がよい。
    return payload;
  }
}

function normalizeCharset(charset: string): string {
  const lower = charset.toLowerCase();
  return lower === 'unknown-8bit' ? 'utf-8' : lower;
}

/** Q encoding（quoted-printable のヘッダ版）。`_` は空白を表す。 */
function decodeQEncoding(payload: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < payload.length; i += 1) {
    const ch = payload[i];
    if (ch === '_') {
      bytes.push(0x20);
    } else if (ch === '=' && i + 2 < payload.length) {
      bytes.push(Number.parseInt(payload.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (ch !== undefined) {
      bytes.push(ch.charCodeAt(0));
    }
  }
  return new Uint8Array(bytes);
}
