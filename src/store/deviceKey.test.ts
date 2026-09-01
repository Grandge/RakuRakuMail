import { describe, expect, it, vi } from 'vitest';
import { loadOrCreateDeviceKey, type KeyVault } from './deviceKey';
import { createDeviceKey } from './crypto';

function vaultWith(initial?: CryptoKey): KeyVault & { stored: CryptoKey | undefined } {
  const vault = {
    stored: initial,
    read: vi.fn(async () => vault.stored),
    write: vi.fn(async (key: CryptoKey) => {
      vault.stored = key;
    }),
  };
  return vault;
}

describe('loadOrCreateDeviceKey', () => {
  it('保管庫が空なら鍵を作って保管する', async () => {
    const vault = vaultWith();
    const key = await loadOrCreateDeviceKey(vault);

    expect(key.extractable).toBe(false);
    expect(vault.write).toHaveBeenCalledTimes(1);
    expect(vault.stored).toBe(key);
  });

  it('保管庫にあればそれを使い、作り直さない', async () => {
    const existing = await createDeviceKey();
    const vault = vaultWith(existing);

    expect(await loadOrCreateDeviceKey(vault)).toBe(existing);
    expect(vault.write).not.toHaveBeenCalled();
  });

  it('2回呼んでも同じ鍵になる（再読み込みで復号できる前提）', async () => {
    const vault = vaultWith();
    const first = await loadOrCreateDeviceKey(vault);
    expect(await loadOrCreateDeviceKey(vault)).toBe(first);
  });

  it('保管に失敗しても、その回に使える鍵は返す', async () => {
    const vault: KeyVault = {
      read: async () => undefined,
      write: async () => {
        throw new Error('保存できない環境');
      },
    };
    const key = await loadOrCreateDeviceKey(vault);
    expect(key.extractable).toBe(false);
  });
});
