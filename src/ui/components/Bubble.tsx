/**
 * 吹き出し1つ（要件定義書 5.3 / D-25）。
 * 自分の発言は右詰め、相手の発言は左詰め。
 */

import type { PanelMessage } from '../../domain/panel';

type Props = {
  readonly message: PanelMessage;
  readonly onRetry?: (message: PanelMessage) => void;
};

export function Bubble({ message, onRetry }: Props) {
  const mine = message.isMine;
  const state = message.pending;

  const className = [
    'bubble',
    mine ? 'mine' : 'theirs',
    state === 'sending' ? 'sending' : '',
    state === 'failed' ? 'failed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`bubble-row ${mine ? 'mine' : ''}`}>
      <div className={className}>
        {!mine && (
          <div className="bubble-sender">
            {message.from.displayName || message.from.email}
          </div>
        )}

        {/* 本文はテキストとして入れる。HTML としては描画しない（D-23 / 6.2）。 */}
        {message.text === '' ? '（本文なし）' : message.text}

        {state === 'failed' ? (
          <>
            <div className="bubble-error">送信できませんでした</div>
            {onRetry && (
              <button
                type="button"
                className="button-secondary"
                onClick={() => onRetry(message)}
              >
                もう一度送る
              </button>
            )}
          </>
        ) : (
          <div className="bubble-meta">
            {state === 'sending' ? '送信しています…' : formatTime(message.sentAt)}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return sameDay
    ? date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
