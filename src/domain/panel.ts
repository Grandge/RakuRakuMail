/**
 * 画面に出す「パネル」（要件定義書 1.3 / SND-01）。
 *
 * **パネルは相手ごとに1つ。** スレッドごとではない。
 * 同じ相手と複数のスレッドがある場合（長いスレッドの分割 3.6、
 * あるいは相手が新しく会話を始めた場合）も、1つのパネルにまとめて時系列に並べる。
 * 4.2 の `Conversation.threadIds` が配列なのはこのため。
 *
 * アドレスが違えば別の相手として扱う（D-37。名寄せはしない）。
 */

import { buildDirectSubject } from '../mail/subject';
import { uuid } from '../lib/uuid';
import type { ConversationView } from './importer';
import type { Account, Contact, Conversation, Message } from './types';

/** 送信中・送信失敗の吹き出しを表すための追加情報（6.3）。 */
export type PendingState = 'sending' | 'failed';

export type PanelMessage = Message & {
  /** 送信中・失敗のときだけ入る。届いたものには付かない。 */
  pending?: PendingState;
  /** 再送のために本文を残す。 */
  draftText?: string;
};

/** パネルが抱えるスレッド1本ぶんの情報。 */
export type PanelThread = {
  threadId: string;
  /** そのスレッドの件名。会話を通じて変えない（3.4 / D-59）。 */
  subject: string;
  /** そのスレッドで最後に見た RFC822 Message-ID。In-Reply-To に使う。 */
  lastMessageId: string | null;
  lastActivityAt: string;
};

export type Panel = {
  /** 相手のメールアドレス（小文字）。相手ごとに1つなのでこれが鍵になる。 */
  key: string;
  peer: { email: string; displayName: string };
  /** 新しい順。先頭が継続送信の対象。 */
  threads: PanelThread[];
  /** まだ1通も送っていないときに使う件名。 */
  draftSubject: string;
  /** 会話ID（独自ヘッダに載せる）。取り込めなければ新規に採番する。 */
  convId: string;
  messages: PanelMessage[];
  peerIsRakurakuUser: boolean;
  lastActivityAt: string;
};

const LOCAL_ACCOUNT_ID = 'local-account';

function keyOf(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 取り込んだ会話（スレッド単位）を、相手ごとのパネルにまとめ直す。
 */
export function panelsFromConversations(
  views: readonly ConversationView[],
  myDisplayName: string,
): Panel[] {
  const byPeer = new Map<string, Panel>();

  for (const view of views) {
    const peer = view.peers[0];
    // 宛先が自分だけのスレッドなど、相手を特定できないものは出さない。
    if (!peer || peer.email === '') continue;

    const key = keyOf(peer.email);
    const thread: PanelThread = {
      threadId: view.threadId,
      subject: view.subject,
      lastMessageId:
        [...view.messages].reverse().find((m) => m.rfcMessageId !== null)?.rfcMessageId ??
        null,
      lastActivityAt: view.lastActivityAt,
    };

    const existing = byPeer.get(key);
    if (!existing) {
      byPeer.set(key, {
        key,
        peer,
        threads: [thread],
        draftSubject: buildDirectSubject(myDisplayName),
        convId: view.convId ?? uuid(),
        messages: [...view.messages],
        peerIsRakurakuUser: view.peerIsRakurakuUser,
        lastActivityAt: view.lastActivityAt,
      });
      continue;
    }

    existing.threads.push(thread);
    existing.messages.push(...view.messages);
    existing.peerIsRakurakuUser = existing.peerIsRakurakuUser || view.peerIsRakurakuUser;
    // 表示名は、入っている方を採る。
    if (existing.peer.displayName === '' && peer.displayName !== '') {
      existing.peer = peer;
    }
    if (view.lastActivityAt > existing.lastActivityAt) {
      existing.lastActivityAt = view.lastActivityAt;
    }
  }

  for (const panel of byPeer.values()) {
    panel.threads.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    panel.messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }

  return [...byPeer.values()].sort((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}

/** まだ1通も送っていない相手のパネルを作る。 */
export function panelForNewContact(input: {
  peer: { email: string; displayName: string };
  myDisplayName: string;
}): Panel {
  const now = new Date().toISOString();
  return {
    key: keyOf(input.peer.email),
    peer: input.peer,
    threads: [],
    draftSubject: buildDirectSubject(input.myDisplayName),
    convId: uuid(),
    messages: [],
    peerIsRakurakuUser: false,
    lastActivityAt: now,
  };
}

/**
 * 継続送信に使う会話情報を組み立てる（3.6 手順1）。
 * スレッドがあれば一番新しいものを継ぐ。無ければ新規に始める。
 */
export function conversationForSend(panel: Panel): Conversation {
  const latest = panel.threads[0];
  return {
    id: panel.convId,
    accountId: LOCAL_ACCOUNT_ID,
    kind: 'direct',
    targetId: panel.key,
    subject: latest?.subject ?? panel.draftSubject,
    threadIds: latest ? [latest.threadId] : [],
    lastMessageId: latest?.lastMessageId ?? null,
    lastActivityAt: panel.lastActivityAt,
  };
}

/** 送信が終わった結果をパネルに反映する。 */
export function applySendResult(
  panel: Panel,
  result: { threadId: string; rfcMessageId: string | null; sentAt: string },
): Panel {
  const others = panel.threads.filter((t) => t.threadId !== result.threadId);
  const previous = panel.threads.find((t) => t.threadId === result.threadId);

  const updated: PanelThread = {
    threadId: result.threadId,
    subject: previous?.subject ?? panel.draftSubject,
    lastMessageId: result.rfcMessageId ?? previous?.lastMessageId ?? null,
    lastActivityAt: result.sentAt,
  };

  return {
    ...panel,
    threads: [updated, ...others],
    lastActivityAt: result.sentAt,
  };
}

/**
 * 取り込み結果と、いま画面にあるパネルを突き合わせる。
 *
 * - 取り込めたものは中身を入れ替える（Gmail が正）
 * - 送信中・失敗の吹き出しは取り込みでは消えないので引き継ぐ
 * - まだ1通も送っていない相手は、そのまま残す
 */
export function mergePanels(current: readonly Panel[], imported: readonly Panel[]): Panel[] {
  const merged = imported.map((next) => {
    const previous = current.find((p) => p.key === next.key);
    if (!previous) return next;

    const stillPending = previous.messages.filter((m) => m.pending !== undefined);
    return {
      ...next,
      peer: {
        email: next.peer.email || previous.peer.email,
        displayName: next.peer.displayName || previous.peer.displayName,
      },
      // 取り込みでは会話IDが読めないことがあるので、持っていた方を残す。
      convId: next.convId,
      messages: [...next.messages, ...stillPending],
    };
  });

  const notImported = current.filter((p) => !merged.some((m) => m.key === p.key));

  return [...merged, ...notImported].sort((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}

/**
 * 送信が終わった吹き出しを、送信中の印を外した形にする。
 * `pending: undefined` を代入するのではなくキーごと落とす
 * （exactOptionalPropertyTypes を有効にしているため）。
 */
export function settleMessage(
  message: PanelMessage,
  patch: Partial<Pick<PanelMessage, 'gmailId' | 'threadId' | 'rfcMessageId'>>,
): PanelMessage {
  const { pending, draftText, ...settled } = message;
  void pending;
  void draftText;
  return { ...settled, ...patch };
}

/** 一覧に出す相手の呼び名。表示名が無ければアドレス。 */
export function peerLabel(peer: { email: string; displayName: string }): string {
  return peer.displayName.trim() !== '' ? peer.displayName : peer.email;
}

/** 一覧に出す、最後のやり取りの要約。 */
export function lastMessageSummary(panel: Panel): string {
  const last = panel.messages[panel.messages.length - 1];
  if (!last) return 'まだやり取りがありません';
  const text = last.text.replace(/\s+/g, ' ').trim();
  if (text === '') return '（本文なし）';
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

/**
 * 保存してあった相手から、取り込む前のパネルを作る（Step 8）。
 *
 * `lastActivityAt` を最古にしておくのは、やり取りのある会話より下に
 * 並べるため。取り込みが済めば `mergePanels` が本当の日時で上書きする。
 */
export function panelsFromContacts(
  contacts: readonly Contact[],
  myDisplayName: string,
): Panel[] {
  return contacts.map((contact) => ({
    key: keyOf(contact.email),
    peer: { email: contact.email, displayName: contact.displayName },
    threads: [],
    draftSubject: buildDirectSubject(myDisplayName),
    convId: uuid(),
    messages: [],
    peerIsRakurakuUser: contact.isRakurakuUser,
    lastActivityAt: new Date(0).toISOString(),
  }));
}

/** 自分を Account として保存する形にする（Step 8 で使う）。 */
export function accountFromProfile(profile: {
  email: string;
  displayName: string;
}): Account {
  return {
    id: LOCAL_ACCOUNT_ID,
    email: profile.email,
    displayName: profile.displayName,
    labelIds: null,
    filterIds: [],
    lastHistoryId: null,
    importRange: '1m',
  };
}

/** 相手を Contact として保存する形にする（Step 8 で使う）。 */
export function contactFromPanel(panel: Panel): Contact {
  return {
    id: panel.key,
    accountId: LOCAL_ACCOUNT_ID,
    email: panel.peer.email,
    displayName: panel.peer.displayName,
    isRakurakuUser: panel.peerIsRakurakuUser,
  };
}
