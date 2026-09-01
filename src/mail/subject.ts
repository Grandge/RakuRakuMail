/**
 * 件名（要件定義書 3.4 / D-59）。
 *
 * Gmailはスレッドをまとめる際に件名も見るため、
 * **1つの会話では件名を変えない。** 会話を開始した人が決めた件名を、
 * 参加者全員がそのまま使い続ける。
 */

import { APP_NAME } from '../config';

/** 1対1の件名。`らくらくメール（<開始した人の表示名>）`。 */
export function buildDirectSubject(starterDisplayName: string): string {
  return `${APP_NAME}（${sanitize(starterDisplayName)}）`;
}

/** グループの件名。`らくらくメール（<グループ名>）`（M5 で使う）。 */
export function buildGroupSubject(groupName: string): string {
  return `${APP_NAME}（${sanitize(groupName)}）`;
}

/**
 * 件名に入れられない文字を落とす。
 * 改行が入るとヘッダを分断してしまう（ヘッダインジェクション）ので必ず消す。
 */
function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

/** `Re: ` `Fwd: ` などの返信接頭辞を落とす。比較のときだけ使う。 */
export function stripReplyPrefix(subject: string): string {
  let result = subject.trim();
  // メールソフトによって Re:, RE:, Re[2]:, Fwd:, 転送: などが重なる。
  const prefix = /^\s*(re|fwd?|返信|転送)\s*(\[\d+\])?\s*[:：]\s*/i;
  while (prefix.test(result)) {
    result = result.replace(prefix, '');
  }
  return result.trim();
}

/** 同じ会話の件名か（接頭辞の違いを無視して比べる）。 */
export function isSameSubject(a: string, b: string): boolean {
  return stripReplyPrefix(a) === stripReplyPrefix(b);
}

/** らくらくメールが作った件名の形か。 */
export function looksLikeRakurakuSubject(subject: string): boolean {
  return stripReplyPrefix(subject).startsWith(`${APP_NAME}（`);
}
