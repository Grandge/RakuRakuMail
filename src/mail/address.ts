/**
 * `From` / `To` の解析。
 *
 * 受信側で見る形は次のいずれか。
 *   芝直之 <taro@example.com>
 *   "Yamada, Taro" <a@example.com>
 *   =?UTF-8?B?6Iqd55u05LmL?= <taro@example.com>
 *   hanako@example.com
 */

import { decodeWords } from './rfc2047';

export type ParsedAddress = {
  email: string;
  /** 表示名。無ければ空文字。 */
  displayName: string;
};

/** アドレス1件を解析する。 */
export function parseAddress(value: string): ParsedAddress {
  const text = value.trim();

  const angle = text.lastIndexOf('<');
  if (angle >= 0) {
    const close = text.indexOf('>', angle);
    const email = text.slice(angle + 1, close < 0 ? undefined : close).trim();
    const namePart = text.slice(0, angle).trim();
    return { email, displayName: cleanName(namePart) };
  }

  return { email: text, displayName: '' };
}

function cleanName(namePart: string): string {
  // quoted-string の引用符とエスケープを外す。
  const unquoted =
    namePart.startsWith('"') && namePart.endsWith('"') && namePart.length >= 2
      ? namePart.slice(1, -1).replace(/\\(["\\])/g, '$1')
      : namePart;
  return decodeWords(unquoted).trim();
}

/**
 * カンマ区切りのアドレス一覧を解析する。
 * 表示名の中のカンマ（`"Yamada, Taro"`）で割らないよう、
 * 引用符と山括弧の内側を数えながら切る。
 */
export function parseAddressList(value: string): ParsedAddress[] {
  const parts: string[] = [];
  let buffer = '';
  let inQuote = false;
  let inAngle = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === undefined) continue;

    if (ch === '"' && value[i - 1] !== '\\') inQuote = !inQuote;
    else if (ch === '<' && !inQuote) inAngle = true;
    else if (ch === '>' && !inQuote) inAngle = false;

    if (ch === ',' && !inQuote && !inAngle) {
      parts.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer.trim() !== '') parts.push(buffer);

  return parts.map(parseAddress).filter((a) => a.email !== '');
}

/** 同じアドレスか（大小を区別しない）。 */
export function isSameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
