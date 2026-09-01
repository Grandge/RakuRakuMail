/** 左ペインのやり取り一覧（要件定義書 5.3）。 */

import type { Panel } from '../../domain/panel';
import { lastMessageSummary, peerLabel } from '../../domain/panel';

type Props = {
  readonly panels: readonly Panel[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
};

export function ConversationList({ panels, selectedKey, onSelect }: Props) {
  if (panels.length === 0) {
    return (
      <p className="list-empty">
        まだ相手がいません。「相手を追加」から、メールアドレスを登録してください。
      </p>
    );
  }

  return (
    <ul className="conversation-list">
      {panels.map((panel) => (
        <li key={panel.key}>
          <button
            type="button"
            className="conversation-item"
            aria-current={panel.key === selectedKey}
            onClick={() => onSelect(panel.key)}
          >
            <div className="conversation-name">{peerLabel(panel.peer)}</div>
            <div className="conversation-preview">{lastMessageSummary(panel)}</div>
            <div className="conversation-time">{formatDay(panel.lastActivityAt)}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);

  if (days <= 0) return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return '昨日';
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}
