/** 会話ID・メッセージIDに使う UUIDv4（要件定義書 3.3 / 4.2）。 */
export function uuid(): string {
  return crypto.randomUUID();
}
