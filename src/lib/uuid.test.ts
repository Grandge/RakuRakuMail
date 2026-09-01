import { describe, expect, it } from 'vitest';
import { uuid } from './uuid';

describe('uuid', () => {
  it('UUIDv4 の形式で返す', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('呼ぶたびに異なる値を返す', () => {
    expect(uuid()).not.toBe(uuid());
  });
});
