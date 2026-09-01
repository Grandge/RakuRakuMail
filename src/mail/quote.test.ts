import { describe, expect, it } from 'vitest';
import { stripQuotedReply } from './quote';

describe('stripQuotedReply', () => {
  it('引用が無ければそのまま返す', () => {
    expect(stripQuotedReply('了解しました')).toBe('了解しました');
  });

  it('Gmail 日本語の引用見出しから後ろを落とす', () => {
    const body = [
      '承知しました',
      '',
      '2026年9月1日(月) 12:34 芝直之 <taro@example.com>:',
      '',
      '> 明日の10時でお願いします',
      '>',
      '> --',
      '> らくらくメール rakurakumail より送信',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('承知しました');
  });

  it('Gmail 英語の "On ... wrote:" から後ろを落とす', () => {
    const body = [
      'Sounds good.',
      '',
      'On Mon, Sep 1, 2026 at 12:34 PM 芝直之 <taro@example.com> wrote:',
      '> Original text',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Sounds good.');
  });

  it('Outlook の Original Message から後ろを落とす', () => {
    const body = ['了解です', '', '-----Original Message-----', '差出人: 芝直之'].join('\n');
    expect(stripQuotedReply(body)).toBe('了解です');
  });

  it('Outlook の区切り線から後ろを落とす', () => {
    const body = ['了解です', '', '________________________________', '差出人: 芝直之'].join(
      '\n',
    );
    expect(stripQuotedReply(body)).toBe('了解です');
  });

  it('見出しが無く > だけの引用でも落とす', () => {
    const body = ['ありがとう', '', '> もとの本文', '> もう1行'].join('\n');
    expect(stripQuotedReply(body)).toBe('ありがとう');
  });

  it('引用の直前の空行も落とす', () => {
    const body = ['本文', '', '', '> 引用'].join('\n');
    expect(stripQuotedReply(body)).toBe('本文');
  });

  it('本文の途中の > は引用と見なさない（末尾まで引用でないため）', () => {
    const body = ['> これは引用ではなく本文の一部', 'この行があるので引用ではない'].join('\n');
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('CRLF の本文でも動く', () => {
    const body = '了解\r\n\r\n> 引用\r\n';
    expect(stripQuotedReply(body)).toBe('了解');
  });

  it('本文が引用だけなら空文字になる', () => {
    expect(stripQuotedReply('> 引用だけ')).toBe('');
  });

  it('「差出人:」だけの行でも落とす', () => {
    const body = ['了解です', '', '差出人: 芝直之 <taro@example.com>', '件名: らくらくメール'].join(
      '\n',
    );
    expect(stripQuotedReply(body)).toBe('了解です');
  });

  it('複数行の本文を保つ', () => {
    const body = ['1行目', '2行目', '', '3行目', '', '> 引用'].join('\n');
    expect(stripQuotedReply(body)).toBe('1行目\n2行目\n\n3行目');
  });
});
