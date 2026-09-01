/**
 * 相手の追加（M1 の簡易版）。
 * M3 で S-04「相手の登録・編集」に育てる。
 */

import { useState } from 'react';
import { isValidEmail } from '../../mail/rfc2047';

type Props = {
  readonly onAdd: (peer: { email: string; displayName: string }) => void;
  readonly onCancel: () => void;
  /** すでに登録済みのアドレス（重複を防ぐ）。 */
  readonly existingEmails: readonly string[];
};

export function AddContactForm({ onAdd, onCancel, existingEmails }: Props) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');

  const trimmed = email.trim();
  const duplicated = existingEmails.some((e) => e.toLowerCase() === trimmed.toLowerCase());
  const error =
    trimmed === ''
      ? null
      : !isValidEmail(trimmed)
        ? 'メールアドレスの形になっていません。'
        : duplicated
          ? 'この相手はすでに登録されています。'
          : null;

  const canAdd = trimmed !== '' && error === null;

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-contact-title"
    >
      <div className="dialog">
        <h2 id="add-contact-title">相手を追加</h2>

        <label className="field-label" htmlFor="contact-email">
          相手のメールアドレス
        </label>
        <input
          id="contact-email"
          className="field-input"
          value={email}
          inputMode="email"
          autoComplete="off"
          onChange={(e) => setEmail(e.target.value)}
        />
        {error !== null && <p className="field-error">{error}</p>}

        <label className="field-label" htmlFor="contact-name">
          相手の呼び名（任意）
        </label>
        <input
          id="contact-name"
          className="field-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <p className="field-hint">
          一覧に表示される名前です。空のままなら、メールアドレスを表示します。
        </p>

        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>
            やめる
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={!canAdd}
            onClick={() => onAdd({ email: trimmed, displayName: displayName.trim() })}
          >
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}
