import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  base64urlToBytes,
  bytesToBase64,
  bytesToBase64url,
  bytesToUtf8,
  decodeBase64url,
  encodeBase64url,
  utf8ToBytes,
  wrapBase64,
} from './base64url';

describe('UTF-8 とバイト列', () => {
  it('日本語を往復できる', () => {
    const text = 'らくらくメール（芝 直之）';
    expect(bytesToUtf8(utf8ToBytes(text))).toBe(text);
  });

  it('絵文字（サロゲートペア）を往復できる', () => {
    const text = '👍🏻 了解しました 🙇‍♂️';
    expect(bytesToUtf8(utf8ToBytes(text))).toBe(text);
  });

  it('UTF-8 のバイト数が正しい', () => {
    // ASCII 1バイト / ひらがな 3バイト / 絵文字 4バイト
    expect(utf8ToBytes('a').length).toBe(1);
    expect(utf8ToBytes('あ').length).toBe(3);
    expect(utf8ToBytes('👍').length).toBe(4);
  });
});

describe('base64url', () => {
  it('日本語を往復できる', () => {
    const text = '明日の10時でお願いします';
    expect(decodeBase64url(encodeBase64url(text))).toBe(text);
  });

  it('パディングの = を含まない', () => {
    // 'a' は1バイト → base64 は 'YQ==' でパディングが2つ付く
    expect(bytesToBase64(utf8ToBytes('a'))).toBe('YQ==');
    expect(encodeBase64url('a')).toBe('YQ');
  });

  it('+ と / を - と _ に置き換える', () => {
    // 0xFB 0xFF は標準 base64 で "+/8=" になる
    const bytes = new Uint8Array([0xfb, 0xff]);
    expect(bytesToBase64(bytes)).toBe('+/8=');
    expect(bytesToBase64url(bytes)).toBe('-_8');
  });

  it('パディングが無い入力も復号できる', () => {
    expect(Array.from(base64urlToBytes('-_8'))).toEqual([0xfb, 0xff]);
  });

  it('空文字を往復できる', () => {
    expect(decodeBase64url(encodeBase64url(''))).toBe('');
  });

  it('大きな入力でもスタックを溢れさせない', () => {
    const text = 'あ'.repeat(200_000); // 600KB
    expect(decodeBase64url(encodeBase64url(text))).toBe(text);
  });

  it('JSON を往復できる（X-Rakuraku-Meta の用途）', () => {
    const meta = { sender: { name: '芝 直之' }, reaction: { emoji: '👍' } };
    expect(JSON.parse(decodeBase64url(encodeBase64url(JSON.stringify(meta))))).toEqual(meta);
  });
});

describe('標準 base64', () => {
  it('往復できる', () => {
    const bytes = utf8ToBytes('こんにちは');
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('wrapBase64', () => {
  it('76文字ごとに CRLF で折り返す', () => {
    const wrapped = wrapBase64('x'.repeat(160));
    const lines = wrapped.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveLength(76);
    expect(lines[1]).toHaveLength(76);
    expect(lines[2]).toHaveLength(8);
  });

  it('76文字以下ならそのまま返す', () => {
    expect(wrapBase64('abc')).toBe('abc');
  });
});
