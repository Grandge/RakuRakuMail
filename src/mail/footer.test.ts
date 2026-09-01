import { describe, expect, it } from 'vitest';
import { appendFooter, hasMarker, stripFooter } from './footer';

describe('appendFooter', () => {
  it('区切り線とフッタ文を末尾に足す', () => {
    const body = appendFooter('明日の10時でお願いします');
    expect(body).toContain('明日の10時でお願いします');
    expect(body).toContain('--\r\nらくらくメール rakurakumail より送信');
  });

  it('目印が含まれる（Gmail検索で拾える / D-16）', () => {
    expect(hasMarker(appendFooter('本文'))).toBe(true);
  });

  it('本文末尾の余分な空白を落としてから足す', () => {
    const body = appendFooter('本文\n\n\n');
    expect(body).toBe('本文\r\n\r\n--\r\nらくらくメール rakurakumail より送信\r\n');
  });

  it('空の本文でもフッタは付く', () => {
    expect(hasMarker(appendFooter(''))).toBe(true);
  });
});

describe('stripFooter', () => {
  it('自分で付けたフッタを取り除ける', () => {
    expect(stripFooter(appendFooter('明日の10時でお願いします'))).toBe(
      '明日の10時でお願いします',
    );
  });

  it('LF 改行のメールでも取り除ける', () => {
    const body = '了解しました\n\n--\nらくらくメール rakurakumail より送信\n';
    expect(stripFooter(body)).toBe('了解しました');
  });

  it('リアクションのフッタ（後置きあり）も取り除ける', () => {
    const body =
      '👍\n\n--\nらくらくメール rakurakumail より送信（リアクション: rakurakureact）\n';
    expect(stripFooter(body)).toBe('👍');
  });

  it('引用の中にフッタが混ざっている場合、最後のものより後ろを落とす', () => {
    // 相手が返信すると、元メールのフッタが引用として残る
    const body = [
      '承知しました',
      '',
      '--',
      'らくらくメール rakurakumail より送信',
      '',
      '> 明日の10時でお願いします',
      '>',
      '> --',
      '> らくらくメール rakurakumail より送信',
    ].join('\n');
    // 最後のフッタより後ろが落ちる。引用の除去は quote.ts の仕事。
    expect(stripFooter(body)).not.toContain('らくらくメール rakurakumail より送信\n\n>');
    expect(stripFooter(body)).toContain('承知しました');
  });

  it('区切り線が失われていてもフッタ行だけは落とす', () => {
    const body = '了解です\nらくらくメール rakurakumail より送信';
    expect(stripFooter(body)).toBe('了解です');
  });

  it('フッタが無い本文はそのまま返す（末尾の空白だけ落とす）', () => {
    expect(stripFooter('ふつうのメールです\n\n')).toBe('ふつうのメールです');
  });

  it('本文中に「らくらくメール」という語があっても消さない', () => {
    const body = 'らくらくメールって便利だね\n\n--\nらくらくメール rakurakumail より送信\n';
    expect(stripFooter(body)).toBe('らくらくメールって便利だね');
  });
});

describe('hasMarker', () => {
  it('目印の有無を判定する', () => {
    expect(hasMarker('本文 rakurakumail')).toBe(true);
    expect(hasMarker('ふつうのメール')).toBe(false);
  });
});
