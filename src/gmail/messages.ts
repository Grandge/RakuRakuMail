/**
 * Gmail API の messages 系（要件定義書 3.6）。
 */

import { gmailFetch } from './http';

export type SendResult = {
  /** Gmail の内部ID。RFC822 の Message-ID とは別物。 */
  id: string;
  threadId: string;
  labelIds?: string[];
};

export type MessageMetadata = {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: { name: string; value: string }[];
  };
};

/**
 * メールを送る。
 *
 * `threadId` を指定すると既存のスレッドに繋がるが、Gmail は件名と
 * References の整合も見る。件名を変えず（3.4）、In-Reply-To を
 * 正しく入れていないと `Invalid thread_id value` で弾かれる。
 */
export async function sendMessage(raw: string, threadId?: string): Promise<SendResult> {
  return await gmailFetch<SendResult>({
    path: '/users/me/messages/send',
    method: 'POST',
    body: threadId === undefined ? { raw } : { raw, threadId },
  });
}

/** 指定したヘッダだけを取り出す（本文は取らないので軽い）。 */
export async function getMessageMetadata(
  id: string,
  headerNames: string[],
): Promise<MessageMetadata> {
  const query: Record<string, string> = { format: 'metadata' };
  // metadataHeaders は同じキーを繰り返す形。URLSearchParams で組み立て直す。
  const params = new URLSearchParams(query);
  for (const name of headerNames) params.append('metadataHeaders', name);

  return await gmailFetch<MessageMetadata>({
    path: `/users/me/messages/${encodeURIComponent(id)}?${params.toString()}`,
  });
}

/** メタデータからヘッダを辞書にする。ヘッダ名は大小を区別しない。 */
export function headersOf(metadata: MessageMetadata): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of metadata.payload?.headers ?? []) {
    out[header.name.toLowerCase()] = header.value;
  }
  return out;
}

/**
 * RFC822 の `Message-ID` を取る。
 *
 * `messages.send` の応答に入っている `id` は Gmail 内部のIDで、
 * `In-Reply-To` には使えない。継続送信のたびにこれで取り直す必要がある。
 */
export async function getRfc822MessageId(id: string): Promise<string | null> {
  const metadata = await getMessageMetadata(id, ['Message-ID']);
  return headersOf(metadata)['message-id'] ?? null;
}
