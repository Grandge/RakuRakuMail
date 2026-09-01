/** 吹き出しの並び（要件定義書 5.3）。新しいものが下。 */

import { useEffect, useRef } from 'react';
import type { PanelMessage } from '../../domain/panel';
import { Bubble } from './Bubble';

type Props = {
  readonly messages: readonly PanelMessage[];
  readonly onRetry?: (message: PanelMessage) => void;
};

export function MessageList({ messages, onRetry }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新しい発言が増えたら一番下へ送る。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="message-scroll">
        <div className="empty-state">
          <p>まだやり取りがありません。下の欄に書いて「送信」を押してください。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-scroll">
      {messages.map((message) => (
        <Bubble
          key={message.gmailId}
          message={message}
          {...(onRetry === undefined ? {} : { onRetry })}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
