/**
 * 受信したメールの解析（要件定義書 3.7）。
 *
 * Gmail API の `format=full` が返す `payload` は入れ子になっている。
 * 本文は `payload.body.data` に直接入っていることも、
 * `payload.parts[]` を再帰的に辿った先にあることもある。
 *
 * 注意:
 * - `body.data` は **base64url**。Gmail が転送符号化（quoted-printable など）を
 *   すでに解いたうえで再符号化しているので、こちらで解く必要はない
 * - ただし文字コードはそのまま。パートの `Content-Type` の `charset` を見て
 *   復号する（相手が ISO-2022-JP で送ってくることがある）
 * - `text/plain` を優先する。HTMLは描画しない（D-23）ので、
 *   `text/html` しか無い場合だけタグを落として文字列にする
 */

import { base64urlToBytes } from './base64url';
import { decodeWords } from './rfc2047';

export type GmailHeader = { name: string; value: string };

export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

/** ヘッダを小文字キーの辞書にする。 */
export function headerMap(part: GmailPart | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of part?.headers ?? []) {
    // 同名ヘッダは最初のものを採る（Received など複数あるものは使わない）。
    const key = header.name.toLowerCase();
    if (!(key in out)) out[key] = header.value;
  }
  return out;
}

/** ヘッダ値を復号して返す（件名や表示名の RFC2047 を解く）。 */
export function decodedHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  return value === undefined ? undefined : decodeWords(value);
}

/** `text/plain; charset="ISO-2022-JP"` から charset を取り出す。 */
function charsetOf(part: GmailPart): string {
  const contentType = headerMap(part)['content-type'] ?? '';
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return (match?.[1] ?? 'utf-8').toLowerCase();
}

function decodePartBody(part: GmailPart): string {
  const data = part.body?.data;
  if (data === undefined || data === '') return '';
  const bytes = base64urlToBytes(data);
  try {
    return new TextDecoder(charsetOf(part)).decode(bytes);
  } catch {
    // 未対応の文字コードは UTF-8 として読む。化けても落とすよりはよい。
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** 添付ではなく本文として扱うパートか。 */
function isBodyPart(part: GmailPart, mimeType: string): boolean {
  return part.mimeType === mimeType && (part.filename ?? '') === '';
}

/** 指定の MIME 型の本文パートを、入れ子を辿って集める。 */
function collectBodies(part: GmailPart | undefined, mimeType: string): string[] {
  if (!part) return [];

  if (isBodyPart(part, mimeType)) {
    const text = decodePartBody(part);
    return text === '' ? [] : [text];
  }

  const results: string[] = [];
  for (const child of part.parts ?? []) {
    results.push(...collectBodies(child, mimeType));
  }
  return results;
}

/**
 * HTML を素朴に文字列へ落とす。
 * 描画はしない（D-23）。`text/plain` が無いときの最後の手段。
 *
 * 改行の作り方はタグによって違うので、走査しながら数える。
 *   `<br>`        並んだ数だけ改行する
 *   `<div>` など  開始・終了が続いても改行は1つ（Gmail の返信は1行=1div）
 *   `<p>` など    段落の区切りなので空行にする
 */
const PARA_TAGS = new Set([
  'p',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'ul',
  'ol',
]);

const LINE_TAGS = new Set(['div', 'tr', 'li', 'section', 'article']);

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
}

export function htmlToText(html: string): string {
  const cleaned = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  let out = '';
  /** ブロック境界から来る改行。続いても重ねない。 */
  let blockBreaks = 0;
  /** br から来る改行。並んだ数だけ足す。 */
  let explicitBreaks = 0;

  function appendText(raw: string): void {
    // HTML では空白の並びは1つに畳まれる。
    const text = decodeEntities(raw).replace(/\s+/g, ' ');
    if (text.trim() === '') return;

    const breaks = Math.min(blockBreaks + explicitBreaks, 2);
    if (out !== '' && breaks > 0) out += '\n'.repeat(breaks);
    blockBreaks = 0;
    explicitBreaks = 0;
    out += out === '' ? text.trimStart() : text;
  }

  const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let last = 0;
  for (const match of cleaned.matchAll(TAG)) {
    appendText(cleaned.slice(last, match.index));

    const tag = (match[1] ?? '').toLowerCase();
    if (tag === 'br') explicitBreaks += 1;
    else if (PARA_TAGS.has(tag)) blockBreaks = Math.max(blockBreaks, 2);
    else if (LINE_TAGS.has(tag)) blockBreaks = Math.max(blockBreaks, 1);

    last = match.index + match[0].length;
  }
  appendText(cleaned.slice(last));

  return out.trim();
}

/** メールの本文を1つの文字列にする。text/plain を優先する。 */
export function extractBodyText(message: GmailMessage): string {
  const plain = collectBodies(message.payload, 'text/plain');
  if (plain.length > 0) return plain.join('\n');

  const html = collectBodies(message.payload, 'text/html');
  if (html.length > 0) return htmlToText(html.join('\n'));

  // multipart でも text でもない（画像だけなど）。M4 で扱う。
  return '';
}

/** 添付・画像パートの一覧（M4 / M7 で使う。M1 では読み取るだけ）。 */
export function listAttachments(message: GmailMessage): GmailPart[] {
  const found: GmailPart[] = [];
  const walk = (part: GmailPart | undefined): void => {
    if (!part) return;
    if ((part.filename ?? '') !== '' && part.body?.attachmentId !== undefined) {
      found.push(part);
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);
  return found;
}
