import { describe, expect, it } from 'vitest';
import { decodeWords, encodeWord, formatAddress, isValidEmail } from './rfc2047';

describe('encodeWord', () => {
  it('ASCII だけなら符号化しない', () => {
    expect(encodeWord('Hello')).toBe('Hello');
  });

  it('空文字はそのまま', () => {
    expect(encodeWord('')).toBe('');
  });

  it('日本語を =?UTF-8?B?...?= にする', () => {
    const encoded = encodeWord('こんにちは');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(decodeWords(encoded)).toBe('こんにちは');
  });

  it('件名の形式（D-59）を往復できる', () => {
    const subject = 'らくらくメール（芝 直之）';
    expect(decodeWords(encodeWord(subject))).toBe(subject);
  });

  it('encoded-word 1つを75文字以下に収める', () => {
    const encoded = encodeWord('あ'.repeat(100));
    for (const line of encoded.split('\r\n ')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });

  it('長い日本語は折り返したうえで往復できる', () => {
    const text = '長い件名のテストです。'.repeat(20);
    const encoded = encodeWord(text);
    expect(encoded).toContain('\r\n ');
    expect(decodeWords(encoded)).toBe(text);
  });

  it('マルチバイト文字を境界で割らない', () => {
    // 3バイト文字ばかりなので、45バイト境界は15文字ごと。
    // 割れていれば復号で文字化けするか、長さが変わる。
    const text = 'あいうえお'.repeat(10);
    expect(decodeWords(encodeWord(text))).toBe(text);
  });

  it('絵文字（4バイト・サロゲートペア）を壊さない', () => {
    const text = '👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍';
    expect(decodeWords(encodeWord(text))).toBe(text);
  });

  it('ASCII でも =? を含むなら符号化する', () => {
    const text = 'これは =? です';
    expect(decodeWords(encodeWord(text))).toBe(text);
  });
});

describe('decodeWords', () => {
  it('符号化されていない値はそのまま返す', () => {
    expect(decodeWords('Plain Subject')).toBe('Plain Subject');
  });

  it('Q encoding も復号できる（他のメールソフト対策）', () => {
    expect(decodeWords('=?UTF-8?Q?Hello=20World?=')).toBe('Hello World');
  });

  it('Q encoding の _ を空白として扱う', () => {
    expect(decodeWords('=?UTF-8?Q?Hello_World?=')).toBe('Hello World');
  });

  it('隣り合う encoded-word の間の空白を取り除く', () => {
    // 「あい」を2つに分けて隣接させた場合、間の空白は消えるべき
    const encoded = '=?UTF-8?B?44GC?= =?UTF-8?B?44GE?=';
    expect(decodeWords(encoded)).toBe('あい');
  });

  it('encoded-word と生テキストの間の空白は残す', () => {
    expect(decodeWords('Re: =?UTF-8?B?44GC?=')).toBe('Re: あ');
  });

  it('折り返された値を畳んでから復号する', () => {
    expect(decodeWords('=?UTF-8?B?44GC?=\r\n =?UTF-8?B?44GE?=')).toBe('あい');
  });

  it('壊れた encoded-word でも例外を投げない', () => {
    expect(() => decodeWords('=?UTF-8?B?!!!notbase64!!!?=')).not.toThrow();
  });
});

describe('formatAddress', () => {
  it('表示名が無ければ <addr> だけ', () => {
    expect(formatAddress('a@example.com')).toBe('<a@example.com>');
    expect(formatAddress('a@example.com', '  ')).toBe('<a@example.com>');
  });

  it('ASCII の表示名は quoted-string にする', () => {
    expect(formatAddress('a@example.com', 'Taro Yamada')).toBe(
      '"Taro Yamada" <a@example.com>',
    );
  });

  it('quoted-string 内の " と \\ をエスケープする', () => {
    expect(formatAddress('a@example.com', 'He said "hi"')).toBe(
      '"He said \\"hi\\"" <a@example.com>',
    );
  });

  it('日本語の表示名は encoded-word にする', () => {
    const formatted = formatAddress('a@example.com', '芝 直之');
    expect(formatted).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <a@example\.com>$/);
    expect(decodeWords(formatted.replace(' <a@example.com>', ''))).toBe('芝 直之');
  });

  it('前後の空白を落としてから組み立てる', () => {
    expect(formatAddress('a@example.com', '  Taro  ')).toBe('"Taro" <a@example.com>');
  });
});

describe('isValidEmail', () => {
  it('普通のアドレスを通す', () => {
    expect(isValidEmail('taro@example.com')).toBe(true);
  });

  it('明らかにおかしいものを弾く', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('a b@example.com')).toBe(false);
    expect(isValidEmail('a@')).toBe(false);
    expect(isValidEmail('<a@example.com>')).toBe(false);
  });
});
