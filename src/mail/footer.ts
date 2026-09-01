/**
 * 本文フッタ（要件定義書 3.2 / D-15, D-16）。
 *
 * Gmailは独自ヘッダを検索・フィルタで扱えないため、
 * **本文フッタの目印文字列だけが、Gmailの機能でらくらくメールのメールを
 * 選び出す唯一の手段**になる。落としてはいけない。
 */

import { FOOTER_SEPARATOR, FOOTER_TEXT, MARKER } from '../config';

/** 送信本文に付けるフッタ全体。 */
export const FOOTER_BLOCK = `${FOOTER_SEPARATOR}\r\n${FOOTER_TEXT}`;

/** 本文の末尾にフッタを足す。 */
export function appendFooter(body: string): string {
  const trimmed = body.replace(/\s+$/, '');
  return `${trimmed}\r\n\r\n${FOOTER_BLOCK}\r\n`;
}

/**
 * 受信本文からフッタを取り除く。
 *
 * 相手が普通のメールソフトで返信すると、フッタが引用の中に紛れたり
 * 改行の入り方が変わったりする。完全な除去は目指さず、
 * 「末尾にある最後のフッタから後ろを落とす」方針にする。
 */
export function stripFooter(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n');

  // 区切り線とフッタ本文がこの順で並んでいる箇所を末尾から探す。
  const pattern = new RegExp(
    `\\n?-{2,}\\s*\\n\\s*らくらくメール\\s+${MARKER}\\s+より送信[^\\n]*\\n?`,
    'g',
  );
  const matches = [...normalized.matchAll(pattern)];
  const last = matches.at(-1);
  if (last?.index !== undefined) {
    return normalized.slice(0, last.index).replace(/\s+$/, '');
  }

  // 区切り線が失われている場合の保険。フッタの行だけを落とす。
  const lineOnly = new RegExp(`^\\s*らくらくメール\\s+${MARKER}\\s+より送信.*$`, 'gm');
  return normalized.replace(lineOnly, '').replace(/\s+$/, '');
}

/** 本文にらくらくメールの目印が含まれるか（3.1）。 */
export function hasMarker(body: string): boolean {
  return body.includes(MARKER);
}
