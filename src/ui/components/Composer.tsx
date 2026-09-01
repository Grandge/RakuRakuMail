/** 入力欄と送信ボタン（要件定義書 5.3 / 5.4）。 */

import { useState } from 'react';

type Props = {
  readonly disabled?: boolean;
  readonly onSend: (text: string) => void;
};

export function Composer({ disabled = false, onSend }: Props) {
  const [text, setText] = useState('');
  const canSend = !disabled && text.trim() !== '';

  function handleSend() {
    if (!canSend) return;
    onSend(text);
    setText('');
  }

  return (
    <div className="composer">
      <label htmlFor="composer-input" className="visually-hidden" hidden>
        メッセージ
      </label>
      <textarea
        id="composer-input"
        className="composer-input"
        placeholder="メッセージを入力"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl+Enter で送る。Enter だけでは送らない
          // （書きかけで送ってしまう事故を防ぐ / NFR-01）。
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <button
        type="button"
        className="button-primary"
        onClick={handleSend}
        disabled={!canSend}
      >
        送信
      </button>
    </div>
  );
}
