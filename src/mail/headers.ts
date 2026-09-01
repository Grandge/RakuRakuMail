/**
 * 独自ヘッダ（要件定義書 3.3 / D-14）。
 *
 * メールヘッダはASCIIしか扱えないため、日本語・絵文字・配列を含む値は
 * `X-Rakuraku-Meta` にまとめてJSONをbase64url符号化して入れる。
 */

import { RAKURAKU_VERSION } from '../config';
import type { RakurakuHeaderSet, RakurakuMeta, RakurakuType } from '../domain/types';
import { decodeBase64url, encodeBase64url } from './base64url';

export const HEADER_VERSION = 'X-Rakuraku-Version';
export const HEADER_TYPE = 'X-Rakuraku-Type';
export const HEADER_CONV_ID = 'X-Rakuraku-Conv-Id';
export const HEADER_MSG_ID = 'X-Rakuraku-Msg-Id';
export const HEADER_GROUP_ID = 'X-Rakuraku-Group-Id';
export const HEADER_META = 'X-Rakuraku-Meta';

const TYPES: readonly string[] = ['message', 'reaction', 'system'];

/** 送信時に付けるヘッダを組み立てる。値はすべてASCIIになる。 */
export function buildRakurakuHeaders(set: {
  type: RakurakuType;
  convId: string;
  msgId: string;
  groupId?: string;
  meta: RakurakuMeta;
}): Record<string, string> {
  const headers: Record<string, string> = {
    [HEADER_VERSION]: RAKURAKU_VERSION,
    [HEADER_TYPE]: set.type,
    [HEADER_CONV_ID]: set.convId,
    [HEADER_MSG_ID]: set.msgId,
    [HEADER_META]: encodeBase64url(JSON.stringify(set.meta)),
  };
  if (set.groupId !== undefined) headers[HEADER_GROUP_ID] = set.groupId;
  return headers;
}

/** ヘッダ名を小文字にそろえた辞書を作る（メールのヘッダ名は大小を区別しない）。 */
export function normalizeHeaderMap(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}

/**
 * 受信したヘッダから独自ヘッダを読み取る。
 * らくらくメールのメールでなければ null。
 *
 * 版数が未知でも落とさない（3.3）。読める範囲だけを返し、
 * `meta` が壊れていれば null にして本文だけを表示させる。
 */
export function parseRakurakuHeaders(
  headers: Record<string, string>,
): RakurakuHeaderSet | null {
  const map = normalizeHeaderMap(headers);

  const version = map[HEADER_VERSION.toLowerCase()];
  if (version === undefined) return null;

  const rawType = map[HEADER_TYPE.toLowerCase()] ?? 'message';
  // 知らない種別は message として扱う（将来 system 以外が増えても壊れない）。
  const type = (TYPES.includes(rawType) ? rawType : 'message') as RakurakuType;

  const set: RakurakuHeaderSet = {
    version,
    type,
    convId: map[HEADER_CONV_ID.toLowerCase()] ?? '',
    msgId: map[HEADER_MSG_ID.toLowerCase()] ?? '',
    meta: parseMeta(map[HEADER_META.toLowerCase()]),
  };

  const groupId = map[HEADER_GROUP_ID.toLowerCase()];
  return groupId === undefined ? set : { ...set, groupId };
}

function parseMeta(encoded: string | undefined): RakurakuMeta | null {
  if (encoded === undefined || encoded === '') return null;
  try {
    // ヘッダが折り返されていることがあるので空白を落としてから復号する。
    const parsed: unknown = JSON.parse(decodeBase64url(encoded.replace(/\s+/g, '')));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as RakurakuMeta;
  } catch {
    return null;
  }
}

/** このメールがらくらくメール由来か（3.9 の利用者判定に使う）。 */
export function isRakurakuMail(headers: Record<string, string>): boolean {
  return normalizeHeaderMap(headers)[HEADER_VERSION.toLowerCase()] !== undefined;
}
