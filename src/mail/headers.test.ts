import { describe, expect, it } from 'vitest';
import {
  HEADER_CONV_ID,
  HEADER_META,
  HEADER_MSG_ID,
  HEADER_TYPE,
  HEADER_VERSION,
  buildRakurakuHeaders,
  isRakurakuMail,
  parseRakurakuHeaders,
} from './headers';
import { decodeBase64url } from './base64url';
import type { RakurakuMeta } from '../domain/types';

const meta: RakurakuMeta = { sender: { name: '芝 直之' } };

describe('buildRakurakuHeaders', () => {
  it('必須ヘッダをすべて出す', () => {
    const headers = buildRakurakuHeaders({
      type: 'message',
      convId: 'conv-1',
      msgId: 'msg-1',
      meta,
    });
    expect(headers[HEADER_VERSION]).toBe('1');
    expect(headers[HEADER_TYPE]).toBe('message');
    expect(headers[HEADER_CONV_ID]).toBe('conv-1');
    expect(headers[HEADER_MSG_ID]).toBe('msg-1');
    expect(headers[HEADER_META]).toBeDefined();
  });

  it('値がすべてASCIIになる（ヘッダはASCIIしか通らない）', () => {
    const headers = buildRakurakuHeaders({
      type: 'message',
      convId: 'conv-1',
      msgId: 'msg-1',
      meta: { sender: { name: '芝 直之' }, reaction: { targetMsgId: 'm', emoji: '👍' } },
    });
    for (const value of Object.values(headers)) {
      expect(value).toMatch(/^[\x20-\x7e]*$/);
    }
  });

  it('Meta を base64url で復号すると元のJSONに戻る', () => {
    const headers = buildRakurakuHeaders({
      type: 'message',
      convId: 'c',
      msgId: 'm',
      meta,
    });
    expect(JSON.parse(decodeBase64url(headers[HEADER_META] ?? ''))).toEqual(meta);
  });

  it('グループIDは指定したときだけ出す', () => {
    const without = buildRakurakuHeaders({ type: 'message', convId: 'c', msgId: 'm', meta });
    expect(without['X-Rakuraku-Group-Id']).toBeUndefined();

    const withGroup = buildRakurakuHeaders({
      type: 'message',
      convId: 'c',
      msgId: 'm',
      groupId: 'g-1',
      meta,
    });
    expect(withGroup['X-Rakuraku-Group-Id']).toBe('g-1');
  });
});

describe('parseRakurakuHeaders', () => {
  it('組み立てたヘッダを読み戻せる', () => {
    const built = buildRakurakuHeaders({
      type: 'reaction',
      convId: 'conv-9',
      msgId: 'msg-9',
      meta,
    });
    const parsed = parseRakurakuHeaders(built);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe('reaction');
    expect(parsed?.convId).toBe('conv-9');
    expect(parsed?.meta).toEqual(meta);
  });

  it('ヘッダ名の大小を区別しない', () => {
    const parsed = parseRakurakuHeaders({
      'x-rakuraku-version': '1',
      'X-RAKURAKU-CONV-ID': 'c',
    });
    expect(parsed?.convId).toBe('c');
  });

  it('らくらくメールでないメールは null', () => {
    expect(parseRakurakuHeaders({ Subject: 'ふつうのメール' })).toBeNull();
  });

  it('知らない版でも落とさず読める範囲を返す（3.3）', () => {
    const parsed = parseRakurakuHeaders({
      [HEADER_VERSION]: '99',
      [HEADER_CONV_ID]: 'c',
      [HEADER_MSG_ID]: 'm',
    });
    expect(parsed?.version).toBe('99');
    expect(parsed?.convId).toBe('c');
    expect(parsed?.meta).toBeNull();
  });

  it('知らない Type は message として扱う', () => {
    const parsed = parseRakurakuHeaders({
      [HEADER_VERSION]: '1',
      [HEADER_TYPE]: 'poll',
    });
    expect(parsed?.type).toBe('message');
  });

  it('Meta が壊れていても null にするだけで例外を投げない', () => {
    const parsed = parseRakurakuHeaders({
      [HEADER_VERSION]: '1',
      [HEADER_META]: '!!!これはbase64ではない!!!',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.meta).toBeNull();
  });

  it('折り返された Meta を読める', () => {
    const built = buildRakurakuHeaders({ type: 'message', convId: 'c', msgId: 'm', meta });
    const folded = (built[HEADER_META] ?? '').replace(/(.{20})/, '$1\r\n ');
    const parsed = parseRakurakuHeaders({ [HEADER_VERSION]: '1', [HEADER_META]: folded });
    expect(parsed?.meta).toEqual(meta);
  });
});

describe('isRakurakuMail', () => {
  it('独自ヘッダがあれば true', () => {
    expect(isRakurakuMail({ [HEADER_VERSION]: '1' })).toBe(true);
  });

  it('無ければ false', () => {
    expect(isRakurakuMail({ From: 'a@example.com' })).toBe(false);
  });
});
