/**
 * 取り込み（要件定義書 3.7 / D-19, D-20, D-21）。
 *
 * **取り込みの単位は会話（スレッド）。**
 * 目印で会話の *起点* を見つけたら、そのスレッドの全メッセージを取り込む。
 * こうすると、相手が Gmail の画面から普通に返信しても
 * （目印も独自ヘッダも無いのに）会話が途切れない。
 *
 * M1 では毎回この全件検索を行う。差分同期（history.list）は M2。
 */

import { MARKER } from '../config';
import { getThread, listMessages, rangeToQuery } from '../gmail/threads';
import { isSameAddress, parseAddress, parseAddressList } from '../mail/address';
import { stripFooter } from '../mail/footer';
import { parseRakurakuHeaders } from '../mail/headers';
import {
  decodedHeader,
  extractBodyText,
  headerMap,
  type GmailMessage,
} from '../mail/parse';
import { stripQuotedReply } from '../mail/quote';
import { log } from '../lib/log';
import type { ImportRange, Message } from './types';

/** 画面に出す会話1件。M1 では永続化せず、毎回組み立て直す。 */
export type ConversationView = {
  threadId: string;
  /** 独自ヘッダから読んだ会話ID。相手が普通のメールで始めた場合は null。 */
  convId: string | null;
  subject: string;
  /** 相手（自分以外の参加者）。1対1なので通常1人。 */
  peers: { email: string; displayName: string }[];
  /** 相手が独自ヘッダ付きのメールを送ってきたことがあるか（3.9）。 */
  peerIsRakurakuUser: boolean;
  messages: Message[];
  lastActivityAt: string;
};

export type ImportProgress = {
  phase: 'searching' | 'fetching' | 'done';
  fetched: number;
  total: number;
};

export type ImportResult = {
  conversations: ConversationView[];
  /** 見つかったスレッド数。 */
  threadCount: number;
  /** 取得に失敗したスレッド。1件失敗しても全体は続ける。 */
  failedThreadIds: string[];
};

/** 検索式を組み立てる。`in:anywhere` で受信トレイをスキップした分も拾う（SND-11）。 */
export function buildImportQuery(range: ImportRange): string {
  const parts = [`"${MARKER}"`, 'in:anywhere', rangeToQuery(range)];
  return parts.filter((p) => p !== '').join(' ');
}

/** 1通のGmailメッセージを画面用の Message に直す。 */
export function toMessage(raw: GmailMessage, myEmail: string): Message {
  const headers = headerMap(raw.payload);
  const from = parseAddress(headers['from'] ?? '');
  const to = parseAddressList(headers['to'] ?? '');

  // フッタを落としてから引用を落とす。順序が逆だと、
  // 引用の中に残ったフッタで切ってしまうことがある。
  const text = stripQuotedReply(stripFooter(extractBodyText(raw)));

  const sentAt =
    raw.internalDate !== undefined
      ? new Date(Number(raw.internalDate)).toISOString()
      : new Date().toISOString();

  return {
    gmailId: raw.id,
    threadId: raw.threadId,
    rfcMessageId: headers['message-id'] ?? null,
    isMine: isSameAddress(from.email, myEmail),
    from: { email: from.email, displayName: from.displayName },
    to: to.map((a) => ({ email: a.email, displayName: a.displayName })),
    sentAt,
    text,
    rakuraku: parseRakurakuHeaders(headers),
  };
}

/** スレッド1つを会話に組み立てる。 */
export function toConversation(
  threadId: string,
  rawMessages: readonly GmailMessage[],
  myEmail: string,
): ConversationView | null {
  if (rawMessages.length === 0) return null;

  const messages = rawMessages
    .map((raw) => toMessage(raw, myEmail))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  const first = messages[0];
  if (!first) return null;

  // 件名はスレッドの最初のメッセージのものを使う（会話を通じて固定 / 3.4）。
  const firstHeaders = headerMap(rawMessages[0]?.payload);
  const subject = decodedHeader(firstHeaders, 'Subject') ?? '(件名なし)';

  // 参加者から自分を除く。
  const peerMap = new Map<string, string>();
  for (const message of messages) {
    for (const person of [message.from, ...message.to]) {
      if (person.email === '' || isSameAddress(person.email, myEmail)) continue;
      const key = person.email.toLowerCase();
      // 表示名は後から来たもので上書きする（相手が名前を設定した場合に追随する）。
      if (person.displayName !== '' || !peerMap.has(key)) {
        peerMap.set(key, person.displayName);
      }
    }
  }

  const convId =
    messages.find((m) => m.rakuraku !== null && m.rakuraku.convId !== '')?.rakuraku?.convId ??
    null;

  const peerIsRakurakuUser = messages.some((m) => !m.isMine && m.rakuraku !== null);

  return {
    threadId,
    convId,
    subject,
    peers: [...peerMap].map(([email, displayName]) => ({ email, displayName })),
    peerIsRakurakuUser,
    messages,
    lastActivityAt: messages[messages.length - 1]?.sentAt ?? first.sentAt,
  };
}

/**
 * 会話をすべて取り込む（3.7 初回取り込みの手順1〜6）。
 * `onProgress` で進捗を返す。1ヶ月100通程度で30秒以内が目安（6.1）。
 */
export async function importConversations(input: {
  myEmail: string;
  range: ImportRange;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<ImportResult> {
  const { myEmail, range, onProgress } = input;

  onProgress?.({ phase: 'searching', fetched: 0, total: 0 });

  const refs = await listMessages(buildImportQuery(range));

  // 同じスレッドに複数の目印付きメールがあるので重複を除く。
  const threadIds = [...new Set(refs.map((ref) => ref.threadId))];
  onProgress?.({ phase: 'fetching', fetched: 0, total: threadIds.length });

  const conversations: ConversationView[] = [];
  const failedThreadIds: string[] = [];

  for (const [index, threadId] of threadIds.entries()) {
    try {
      const thread = await getThread(threadId);
      const conversation = toConversation(threadId, thread.messages ?? [], myEmail);
      if (conversation) conversations.push(conversation);
    } catch (e) {
      // 1件失敗しても残りは取り込む。画面を白紙にしない（6.3）。
      log.warn('スレッドを取得できなかった', threadId, e);
      failedThreadIds.push(threadId);
    }
    onProgress?.({ phase: 'fetching', fetched: index + 1, total: threadIds.length });
  }

  conversations.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  onProgress?.({ phase: 'done', fetched: threadIds.length, total: threadIds.length });

  return { conversations, threadCount: threadIds.length, failedThreadIds };
}
