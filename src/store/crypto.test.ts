import { describe, expect, it } from 'vitest';
import { createDeviceKey, decryptJson, encryptJson } from './crypto';

describe('createDeviceKey', () => {
  it('取り出せない鍵を作る（D-49 の前提）', async () => {
    const key = await createDeviceKey();
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('鍵素材を書き出せない', async () => {
    const key = await createDeviceKey();
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });
});

describe('encryptJson / decryptJson', () => {
  it('日本語を含むオブジェクトを往復できる', async () => {
    const key = await createDeviceKey();
    const value = { email: 'taro@example.com', displayName: '芝直之', emoji: '👍' };
    expect(await decryptJson(key, await encryptJson(key, value))).toEqual(value);
  });

  it('毎回ちがう暗号文になる（IVを使い回さない）', async () => {
    const key = await createDeviceKey();
    const a = await encryptJson(key, { x: 1 });
    const b = await encryptJson(key, { x: 1 });
    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
    expect(new Uint8Array(a.data)).not.toEqual(new Uint8Array(b.data));
  });

  it('別の鍵では復号できず null を返す', async () => {
    const encrypted = await encryptJson(await createDeviceKey(), { secret: 'value' });
    expect(await decryptJson(await createDeviceKey(), encrypted)).toBeNull();
  });

  it('データが壊れていても例外を投げず null を返す', async () => {
    const key = await createDeviceKey();
    const encrypted = await encryptJson(key, { x: 1 });
    const broken = new Uint8Array(encrypted.data);
    broken[0] = (broken[0] ?? 0) ^ 0xff;
    expect(await decryptJson(key, { iv: encrypted.iv, data: broken.buffer })).toBeNull();
  });

  it('配列も往復できる（Contact の一覧を想定）', async () => {
    const key = await createDeviceKey();
    const value = [{ email: 'a@example.com' }, { email: 'b@example.com' }];
    expect(await decryptJson(key, await encryptJson(key, value))).toEqual(value);
  });
});
