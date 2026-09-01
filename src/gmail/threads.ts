/**
 * Gmail API の threads / messages.list（要件定義書 3.7）。
 */

import type { GmailMessage } from '../mail/parse';
import { gmailFetch } from './http';

export type MessageRef = { id: string; threadId: string };

export type ListResponse = {
  messages?: MessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type ThreadResponse = {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
};

/**
 * 検索してメッセージの参照を集める。
 * ページが分かれていれば最後まで辿る（1ヶ月100通程度なので1〜2回で終わる）。
 */
export async function listMessages(query: string, maxPages = 10): Promise<MessageRef[]> {
  const refs: MessageRef[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await gmailFetch<ListResponse>({
      path: '/users/me/messages',
      query: { q: query, maxResults: '100', pageToken },
    });
    refs.push(...(response.messages ?? []));

    pageToken = response.nextPageToken;
    if (pageToken === undefined) break;
  }

  return refs;
}

/** スレッドを丸ごと取る。目印の無い返信もここで拾われる（D-19）。 */
export async function getThread(threadId: string): Promise<ThreadResponse> {
  return await gmailFetch<ThreadResponse>({
    path: `/users/me/threads/${encodeURIComponent(threadId)}`,
    query: { format: 'full' },
  });
}

/** 取込範囲（D-45）を Gmail の検索式に直す。 */
export function rangeToQuery(range: '1m' | '3m' | '1y' | 'all'): string {
  switch (range) {
    case '1m':
      return 'newer_than:1m';
    case '3m':
      return 'newer_than:3m';
    case '1y':
      return 'newer_than:1y';
    case 'all':
      return '';
  }
}
