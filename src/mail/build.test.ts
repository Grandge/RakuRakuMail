import { describe, expect, it } from 'vitest';
import { buildMimeMessage, buildRawMessage, type OutgoingMessage } from './build';
import { base64ToBytes, bytesToUtf8, decodeBase64url } from './base64url';
import { decodeWords } from './rfc2047';
import { buildRakurakuHeaders } from './headers';
import { buildDirectSubject } from './subject';

function sample(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    from: { email: 'taro@example.com', displayName: '芝 直之' },
    to: [{ email: 'hanako@example.com' }],
    subject: buildDirectSubject('芝 直之'),
    bodyText: '明日の10時でお願いします',
    rakurakuHeaders: buildRakurakuHeaders({
      type: 'message',
      convId: 'conv-1',
      msgId: 'msg-1',
      meta: { sender: { name: '芝 直之' } },
    }),
    ...overrides,
  };
}

/** 組み立てたメッセージをヘッダ辞書と本文に分解する。 */
function parse(mime: string): { headers: Record<string, string>; body: string } {
  const separator = mime.indexOf('\r\n\r\n');
  const rawHeaders = mime.slice(0, separator);
  const rawBody = mime.slice(separator + 4);

  const headers: Record<string, string> = {};
  // 折り返し（継続行）を畳んでから分解する。
  for (const line of rawHeaders.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon)] = line.slice(colon + 1).trim();
  }

  const body =
    headers['Content-Transfer-Encoding'] === 'base64'
      ? bytesToUtf8(base64ToBytes(rawBody.replace(/\r\n/g, '')))
      : rawBody;

  return { headers, body };
}

describe('buildMimeMessage', () => {
  it('改行が CRLF になっている', () => {
    const mime = buildMimeMessage(sample());
    expect(mime).toContain('\r\n');
    // CRLF でない裸の LF が無いこと
    expect(/[^\r]\n/.test(mime)).toBe(false);
  });

  it('ヘッダと本文が空行で区切られている', () => {
    expect(buildMimeMessage(sample())).toContain('\r\n\r\n');
  });

  it('件名が RFC2047 で符号化され、復号すると元に戻る', () => {
    const { headers } = parse(buildMimeMessage(sample()));
    expect(headers['Subject']).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeWords(headers['Subject'] ?? '')).toBe('らくらくメール（芝 直之）');
  });

  it('差出人の表示名が符号化され、アドレスはそのまま入る', () => {
    const { headers } = parse(buildMimeMessage(sample()));
    const from = headers['From'] ?? '';
    expect(from).toContain('<taro@example.com>');
    expect(decodeWords(from)).toContain('芝 直之');
  });

  it('宛先に表示名が無ければ <addr> だけ', () => {
    const { headers } = parse(buildMimeMessage(sample()));
    expect(headers['To']).toBe('<hanako@example.com>');
  });

  it('宛先が複数ならカンマで並べる', () => {
    const mime = buildMimeMessage(
      sample({ to: [{ email: 'a@example.com' }, { email: 'b@example.com' }] }),
    );
    expect(parse(mime).headers['To']).toBe('<a@example.com>, <b@example.com>');
  });

  it('本文が UTF-8 の base64 で入り、復号すると読める', () => {
    const { headers, body } = parse(buildMimeMessage(sample()));
    expect(headers['Content-Type']).toBe('text/plain; charset="UTF-8"');
    expect(headers['Content-Transfer-Encoding']).toBe('base64');
    expect(body).toContain('明日の10時でお願いします');
  });

  it('本文にフッタが付いている（3.2 / D-16）', () => {
    const { body } = parse(buildMimeMessage(sample()));
    expect(body).toContain('--\r\nらくらくメール rakurakumail より送信');
  });

  it('独自ヘッダがすべて入っている（3.3）', () => {
    const { headers } = parse(buildMimeMessage(sample()));
    expect(headers['X-Rakuraku-Version']).toBe('1');
    expect(headers['X-Rakuraku-Type']).toBe('message');
    expect(headers['X-Rakuraku-Conv-Id']).toBe('conv-1');
    expect(headers['X-Rakuraku-Msg-Id']).toBe('msg-1');
    expect(headers['X-Rakuraku-Meta']).toBeDefined();
  });

  it('継続送信では In-Reply-To と References が入る', () => {
    const { headers } = parse(
      buildMimeMessage(
        sample({
          inReplyTo: '<abc@mail.gmail.com>',
          references: ['<first@mail.gmail.com>', '<abc@mail.gmail.com>'],
        }),
      ),
    );
    expect(headers['In-Reply-To']).toBe('<abc@mail.gmail.com>');
    expect(headers['References']).toBe('<first@mail.gmail.com> <abc@mail.gmail.com>');
  });

  it('新規送信では In-Reply-To と References を出さない', () => {
    const { headers } = parse(buildMimeMessage(sample()));
    expect(headers['In-Reply-To']).toBeUndefined();
    expect(headers['References']).toBeUndefined();
  });

  it('件名に改行を入れてもヘッダを分断できない', () => {
    const mime = buildMimeMessage(
      sample({ subject: '件名\r\nBcc: attacker@example.com' }),
    );
    expect(parse(mime).headers['Bcc']).toBeUndefined();
  });

  it('本文に改行や引用符が入っても壊れない', () => {
    const text = '1行目\n2行目\n\n"引用" と <タグ> と --\n';
    const { body } = parse(buildMimeMessage(sample({ bodyText: text })));
    expect(body).toContain('1行目');
    expect(body).toContain('"引用" と <タグ>');
  });

  it('base64 の本文が76文字以下で折り返される（RFC 2045）', () => {
    const mime = buildMimeMessage(sample({ bodyText: 'あ'.repeat(500) }));
    const rawBody = mime.slice(mime.indexOf('\r\n\r\n') + 4);
    for (const line of rawBody.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});

describe('buildRawMessage', () => {
  it('base64url になっている（+ / = を含まない）', () => {
    const raw = buildRawMessage(sample());
    expect(raw).not.toMatch(/[+/=]/);
  });

  it('復号すると組み立てたMIMEと一致する', () => {
    const message = sample();
    expect(decodeBase64url(buildRawMessage(message))).toBe(buildMimeMessage(message));
  });
});
