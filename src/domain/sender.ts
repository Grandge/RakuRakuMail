/**
 * 送信の一連（要件定義書 3.6 手順1〜5）。
 *
 * M1 の範囲:
 *   1. 会話の情報を取得する。無ければ新規に採番する
 *   2. MIMEメッセージを組み立てる
 *   3. users.messages.send を実行する（継続なら threadId を指定）
 *   4. ラベル付与 … M2 で足す（ラベルの自動作成が M2 のため）
 *   5. 会話のスレッドIDと最終メッセージIDを更新する
 */

import { buildRawMessage } from '../mail/build';
import { buildRakurakuHeaders } from '../mail/headers';
import { buildDirectSubject } from '../mail/subject';
import { getRfc822MessageId, sendMessage } from '../gmail/messages';
import { log } from '../lib/log';
import { uuid } from '../lib/uuid';
import type { Conversation } from './types';

export type SendTextInput = {
  /** 自分。表示名は差出人名と件名に使う。 */
  me: { email: string; displayName: string };
  /** 相手。1対1なので1人。 */
  peer: { email: string; displayName?: string };
  /** 継続する会話。無ければ新規に始める。 */
  conversation: Conversation | null;
  /** 自分のアカウントID（会話を新規作成するときに使う）。 */
  accountId: string;
  /** 相手のID（会話を新規作成するときに使う）。 */
  contactId: string;
  bodyText: string;
};

export type SendTextResult = {
  /** 送信後の会話。呼び出し側はこれを保存する。 */
  conversation: Conversation;
  gmailId: string;
  threadId: string;
  /** 送ったメッセージの RFC822 Message-ID。取れなければ null。 */
  rfcMessageId: string | null;
  /** 独自ヘッダの X-Rakuraku-Msg-Id。 */
  rakurakuMsgId: string;
};

/** 新しい1対1の会話を作る。件名はここで決まり、以後変えない（3.4 / D-59）。 */
export function startDirectConversation(input: {
  accountId: string;
  contactId: string;
  starterDisplayName: string;
}): Conversation {
  return {
    id: uuid(),
    accountId: input.accountId,
    kind: 'direct',
    targetId: input.contactId,
    subject: buildDirectSubject(input.starterDisplayName),
    threadIds: [],
    lastMessageId: null,
    lastActivityAt: new Date().toISOString(),
  };
}

export async function sendText(input: SendTextInput): Promise<SendTextResult> {
  // 手順1: 会話が無ければ新規に採番する
  const conversation =
    input.conversation ??
    startDirectConversation({
      accountId: input.accountId,
      contactId: input.contactId,
      starterDisplayName: input.me.displayName,
    });

  const rakurakuMsgId = uuid();

  // 手順2: MIME を組み立てる
  const continuingThreadId = conversation.threadIds.at(-1);
  const raw = buildRawMessage({
    from: { email: input.me.email, displayName: input.me.displayName },
    to: [
      input.peer.displayName === undefined
        ? { email: input.peer.email }
        : { email: input.peer.email, displayName: input.peer.displayName },
    ],
    subject: conversation.subject,
    bodyText: input.bodyText,
    rakurakuHeaders: buildRakurakuHeaders({
      type: 'message',
      convId: conversation.id,
      msgId: rakurakuMsgId,
      meta: { sender: { name: input.me.displayName } },
    }),
    ...(conversation.lastMessageId === null
      ? {}
      : {
          inReplyTo: conversation.lastMessageId,
          references: [conversation.lastMessageId],
        }),
  });

  // 手順3: 送る
  const sent = await sendMessage(raw, continuingThreadId);

  // 手順5の準備: In-Reply-To に使う RFC822 の Message-ID を取り直す。
  // send の応答の id は Gmail 内部IDで、In-Reply-To には使えない。
  let rfcMessageId: string | null = null;
  try {
    rfcMessageId = await getRfc822MessageId(sent.id);
  } catch (e) {
    // 取れなくても送信自体は成功している。次の送信が新しいスレッドに
    // なる可能性があるだけなので、ここで失敗にはしない。
    log.warn('Message-ID を取得できなかった', e);
  }

  // 手順5: 会話を更新する
  const threadIds = conversation.threadIds.includes(sent.threadId)
    ? conversation.threadIds
    : [...conversation.threadIds, sent.threadId];

  return {
    conversation: {
      ...conversation,
      threadIds,
      lastMessageId: rfcMessageId ?? conversation.lastMessageId,
      lastActivityAt: new Date().toISOString(),
    },
    gmailId: sent.id,
    threadId: sent.threadId,
    rfcMessageId,
    rakurakuMsgId,
  };
}
