import { describe, expect, it } from 'vitest';
import {
  decodedHeader,
  extractBodyText,
  headerMap,
  htmlToText,
  listAttachments,
  type GmailMessage,
  type GmailPart,
} from './parse';
import { bytesToBase64url, utf8ToBytes } from './base64url';

function textPart(text: string, mimeType = 'text/plain', charset = 'UTF-8'): GmailPart {
  return {
    mimeType,
    headers: [{ name: 'Content-Type', value: `${mimeType}; charset="${charset}"` }],
    body: { data: bytesToBase64url(utf8ToBytes(text)) },
  };
}

function message(payload: GmailPart): GmailMessage {
  return { id: 'm1', threadId: 't1', payload };
}

describe('headerMap', () => {
  it('ヘッダ名を小文字にそろえる', () => {
    const map = headerMap({ headers: [{ name: 'Subject', value: 'テスト' }] });
    expect(map['subject']).toBe('テスト');
  });

  it('同名ヘッダは最初のものを採る', () => {
    const map = headerMap({
      headers: [
        { name: 'Received', value: 'first' },
        { name: 'Received', value: 'second' },
      ],
    });
    expect(map['received']).toBe('first');
  });

  it('payload が無くても落ちない', () => {
    expect(headerMap(undefined)).toEqual({});
  });
});

describe('decodedHeader', () => {
  it('RFC2047 を復号する', () => {
    const map = { subject: '=?UTF-8?B?44KJ44GP44KJ44GP44Oh44O844Or?=' };
    expect(decodedHeader(map, 'Subject')).toBe('らくらくメール');
  });

  it('無いヘッダは undefined', () => {
    expect(decodedHeader({}, 'Subject')).toBeUndefined();
  });
});

describe('extractBodyText', () => {
  it('body.data に直接入っている本文を読む', () => {
    expect(extractBodyText(message(textPart('こんにちは')))).toBe('こんにちは');
  });

  it('multipart/alternative から text/plain を選ぶ', () => {
    const payload: GmailPart = {
      mimeType: 'multipart/alternative',
      parts: [textPart('平文のほう'), textPart('<p>HTMLのほう</p>', 'text/html')],
    };
    expect(extractBodyText(message(payload))).toBe('平文のほう');
  });

  it('text/plain が無ければ text/html をタグを落として使う', () => {
    const payload: GmailPart = {
      mimeType: 'multipart/alternative',
      parts: [textPart('<p>HTMLだけ</p><p>2行目</p>', 'text/html')],
    };
    expect(extractBodyText(message(payload))).toBe('HTMLだけ\n\n2行目');
  });

  it('入れ子の multipart を再帰的に辿る', () => {
    const payload: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [textPart('深いところの本文')],
        },
        {
          mimeType: 'image/png',
          filename: 'photo.png',
          body: { attachmentId: 'att-1' },
        },
      ],
    };
    expect(extractBodyText(message(payload))).toBe('深いところの本文');
  });

  it('ファイル名が付いた text/plain は添付として扱い、本文にしない', () => {
    const attachment: GmailPart = {
      ...textPart('添付テキストの中身'),
      filename: 'note.txt',
    };
    const payload: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [textPart('本当の本文'), attachment],
    };
    expect(extractBodyText(message(payload))).toBe('本当の本文');
  });

  it('本文が無ければ空文字', () => {
    expect(extractBodyText(message({ mimeType: 'image/png' }))).toBe('');
  });

  it('日本語が文字化けしない', () => {
    const text = 'らくらくメール（芝 直之）👍 明日の10時でお願いします';
    expect(extractBodyText(message(textPart(text)))).toBe(text);
  });

  it('未対応の文字コードでも例外を投げない', () => {
    const part: GmailPart = {
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset="x-unknown-9999"' }],
      body: { data: bytesToBase64url(utf8ToBytes('あいう')) },
    };
    expect(() => extractBodyText(message(part))).not.toThrow();
  });

  it('charset の指定が無ければ UTF-8 として読む', () => {
    const part: GmailPart = {
      mimeType: 'text/plain',
      body: { data: bytesToBase64url(utf8ToBytes('charsetなし')) },
    };
    expect(extractBodyText(message(part))).toBe('charsetなし');
  });
});

describe('htmlToText', () => {
  it('タグを落とす', () => {
    expect(htmlToText('<p>こんにちは</p>')).toBe('こんにちは');
  });

  it('br を改行にする', () => {
    expect(htmlToText('1行目<br>2行目')).toBe('1行目\n2行目');
  });

  it('連続する div が繋がらない（開始タグでも改行する）', () => {
    expect(htmlToText('<div>1行目</div><div>2行目</div>')).toBe('1行目\n2行目');
  });

  it('Gmail の HTML 返信のような入れ子でも行が潰れない', () => {
    const html = '<div dir="ltr">承知しました</div><div><br></div><div>よろしく</div>';
    expect(htmlToText(html)).toBe('承知しました\n\nよろしく');
  });

  it('script と style の中身を落とす', () => {
    expect(htmlToText('<script>alert(1)</script>本文')).toBe('本文');
    expect(htmlToText('<style>p{color:red}</style>本文')).toBe('本文');
  });

  it('実体参照を戻す', () => {
    expect(htmlToText('&lt;タグ&gt; &amp; &quot;引用&quot;')).toBe('<タグ> & "引用"');
  });
});

describe('listAttachments', () => {
  it('添付だけを拾う', () => {
    const payload: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [
        textPart('本文'),
        { mimeType: 'image/png', filename: 'a.png', body: { attachmentId: 'x' } },
      ],
    };
    expect(listAttachments(message(payload))).toHaveLength(1);
    expect(listAttachments(message(payload))[0]?.filename).toBe('a.png');
  });

  it('添付が無ければ空', () => {
    expect(listAttachments(message(textPart('本文')))).toEqual([]);
  });
});
