/**
 * 送信するMIMEメッセージの組み立て（要件定義書 3.6 手順2）。
 *
 * M1 はテキストのみ。画像・添付（multipart/mixed）は M4 / M7 で足す。
 *
 * 本文を base64 にするのは、日本語で行が長くなったときの折り返し規則
 * （RFC 5322 の998文字制限）を気にせずに済ませるため。
 */

import { bytesToBase64, encodeBase64url, utf8ToBytes, wrapBase64 } from './base64url';
import { appendFooter } from './footer';
import { encodeWord, formatAddress } from './rfc2047';

export type Address = {
  email: string;
  displayName?: string;
};

export type OutgoingMessage = {
  from: Address;
  to: Address[];
  /** 会話を通じて固定（3.4）。呼び出し側で組み立てる。 */
  subject: string;
  /** フッタを付ける前の本文。 */
  bodyText: string;
  /** 独自ヘッダ（3.3）。すでにASCII化されたもの。 */
  rakurakuHeaders: Record<string, string>;
  /** 継続送信のとき。RFC822 の Message-ID（`<...>` 込み）。 */
  inReplyTo?: string;
  references?: string[];
};

const CRLF = '\r\n';

/**
 * ヘッダの値に改行を入れさせない。
 * 入ると別のヘッダを注入できてしまう（ヘッダインジェクション）。
 */
function safeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

function headerLine(name: string, value: string): string {
  return `${name}: ${safeHeaderValue(value)}`;
}

/** RFC5322 のメッセージ全体を組み立てる。改行は CRLF。 */
export function buildMimeMessage(message: OutgoingMessage): string {
  const lines: string[] = [];

  lines.push(headerLine('From', formatAddress(message.from.email, message.from.displayName)));
  lines.push(
    headerLine(
      'To',
      message.to.map((a) => formatAddress(a.email, a.displayName)).join(', '),
    ),
  );
  lines.push(headerLine('Subject', encodeWord(message.subject)));

  if (message.inReplyTo !== undefined && message.inReplyTo !== '') {
    lines.push(headerLine('In-Reply-To', message.inReplyTo));
  }
  const references = message.references?.filter((r) => r !== '') ?? [];
  if (references.length > 0) {
    lines.push(headerLine('References', references.join(' ')));
  }

  lines.push(headerLine('MIME-Version', '1.0'));
  lines.push(headerLine('Content-Type', 'text/plain; charset="UTF-8"'));
  lines.push(headerLine('Content-Transfer-Encoding', 'base64'));

  for (const [name, value] of Object.entries(message.rakurakuHeaders)) {
    lines.push(headerLine(name, value));
  }

  const body = appendFooter(message.bodyText);
  const encodedBody = wrapBase64(bytesToBase64(utf8ToBytes(body)));

  // ヘッダと本文は空行で区切る。
  return `${lines.join(CRLF)}${CRLF}${CRLF}${encodedBody}${CRLF}`;
}

/**
 * Gmail API の `raw` に渡す形にする。
 * **base64url**（`+`→`-`、`/`→`_`、末尾の `=` を落とす）でなければ弾かれる。
 */
export function buildRawMessage(message: OutgoingMessage): string {
  return encodeBase64url(buildMimeMessage(message));
}
