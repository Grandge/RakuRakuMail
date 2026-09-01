/**
 * S-03 メイン画面（要件定義書 5.1 / 5.3）。
 *
 * 768px 以上は2ペイン、未満は1ペイン。
 * 同期はアプリを開いたときと「更新」を押したときだけ（D-44 / NFR-07）。
 */

import { useCallback, useEffect, useState } from 'react';
import { AuthError, signOut } from '../../auth/session';
import { GmailError } from '../../gmail/http';
import { importConversations, type ImportProgress } from '../../domain/importer';
import {
  accountFromProfile,
  applySendResult,
  contactFromPanel,
  conversationForSend,
  mergePanels,
  panelForNewContact,
  panelsFromContacts,
  panelsFromConversations,
  peerLabel,
  settleMessage,
  type Panel,
  type PanelMessage,
} from '../../domain/panel';
import { sendText } from '../../domain/sender';
import { loadSettings, saveAccount, saveContacts } from '../../store/db';
import type { MyProfile } from '../../gmail/profile';
import { APP_NAME } from '../../config';
import { log } from '../../lib/log';
import { uuid } from '../../lib/uuid';
import { AddContactForm } from '../components/AddContactForm';
import { ConversationList } from '../components/ConversationList';
import { Composer } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { useOnline } from '../useOnline';

type Props = {
  readonly profile: MyProfile;
  readonly myDisplayName: string;
};

export function MainScreen({ profile, myDisplayName }: Props) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [sending, setSending] = useState(false);
  const online = useOnline();

  const refresh = useCallback(async () => {
    setProgress({ phase: 'searching', fetched: 0, total: 0 });
    setNotice(null);
    try {
      const result = await importConversations({
        myEmail: profile.email,
        range: '1m',
        onProgress: setProgress,
      });
      setPanels((current) =>
        mergePanels(current, panelsFromConversations(result.conversations, myDisplayName)),
      );
      if (result.failedThreadIds.length > 0) {
        setNotice(
          `${result.failedThreadIds.length}件のやり取りを読み込めませんでした。「更新」でもう一度お試しください。`,
        );
      }
    } catch (e) {
      log.error('取り込みに失敗', e);
      // 画面は白紙にせず、前の内容を残したまま警告だけ出す（6.3）。
      setNotice(
        e instanceof GmailError || e instanceof AuthError
          ? e.userMessage
          : '読み込めませんでした。時間をおいて「更新」を押してください。',
      );
    } finally {
      setProgress(null);
    }
  }, [profile.email, myDisplayName]);

  // 端末に保存してある相手を先に出してから取り込む（D-49 / Step 8）。
  // 保存が読めなくても空で始めるだけで、取り込みは通常どおり動く。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadSettings();
      if (!cancelled && saved.contacts.length > 0) {
        setPanels((current) =>
          mergePanels(current, panelsFromContacts(saved.contacts, myDisplayName)),
        );
      }
      void saveAccount(accountFromProfile({ email: profile.email, displayName: myDisplayName }));
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, profile.email, myDisplayName]);

  // 相手が増減したら保存し直す（件数が少ないのでまとめて書く）。
  useEffect(() => {
    if (panels.length === 0) return;
    void saveContacts(panels.map(contactFromPanel));
  }, [panels]);

  const selected = panels.find((p) => p.key === selectedKey) ?? null;

  function handleAddContact(peer: { email: string; displayName: string }) {
    const panel = panelForNewContact({ peer, myDisplayName });
    setPanels((current) => [panel, ...current]);
    setSelectedKey(panel.key);
    setShowAddContact(false);
  }

  async function handleSend(text: string, panel: Panel) {
    const localId = `local-${uuid()}`;
    const optimistic: PanelMessage = {
      gmailId: localId,
      threadId: panel.threads[0]?.threadId ?? '',
      rfcMessageId: null,
      isMine: true,
      from: { email: profile.email, displayName: myDisplayName },
      to: [{ email: panel.peer.email, displayName: panel.peer.displayName }],
      sentAt: new Date().toISOString(),
      text,
      rakuraku: null,
      pending: 'sending',
      draftText: text,
    };

    updatePanel(panel.key, (p) => ({ ...p, messages: [...p.messages, optimistic] }));
    setSending(true);

    try {
      const conversation = conversationForSend(panel);
      const result = await sendText({
        me: { email: profile.email, displayName: myDisplayName },
        peer: { email: panel.peer.email },
        conversation,
        accountId: conversation.accountId,
        contactId: panel.key,
        bodyText: text,
      });

      const sentAt = new Date().toISOString();
      updatePanel(panel.key, (p) => ({
        ...applySendResult(p, {
          threadId: result.threadId,
          rfcMessageId: result.rfcMessageId,
          sentAt,
        }),
        messages: p.messages.map((m) =>
          m.gmailId === localId
            ? settleMessage(m, {
                gmailId: result.gmailId,
                threadId: result.threadId,
                rfcMessageId: result.rfcMessageId,
              })
            : m,
        ),
      }));
    } catch (e) {
      log.error('送信に失敗', e);
      // 入力内容を失わせない（6.3）。吹き出しを失敗状態で残して再送できるようにする。
      updatePanel(panel.key, (p) => ({
        ...p,
        messages: p.messages.map((m) =>
          m.gmailId === localId ? { ...m, pending: 'failed' as const } : m,
        ),
      }));
      setNotice(
        e instanceof GmailError || e instanceof AuthError
          ? e.userMessage
          : '送信できませんでした。時間をおいてもう一度お試しください。',
      );
    } finally {
      setSending(false);
    }
  }

  function updatePanel(key: string, update: (panel: Panel) => Panel) {
    setPanels((current) => current.map((p) => (p.key === key ? update(p) : p)));
  }

  function handleRetry(message: PanelMessage, panel: Panel) {
    updatePanel(panel.key, (p) => ({
      ...p,
      messages: p.messages.filter((m) => m.gmailId !== message.gmailId),
    }));
    void handleSend(message.draftText ?? message.text, panel);
  }

  const busy = progress !== null;
  const showPanel = selected !== null;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-title">{APP_NAME}</h1>
          <div className="app-account">
            {myDisplayName}（{profile.email}）
          </div>
        </div>
        {/*
          ログアウトでは端末の保存データを消さない。消去は S-07 設定画面の
          「この端末のデータを消す」から確認画面を挟んで行う（要件定義書 6.2 / 5.4 / D-55）。
        */}
        <button type="button" className="button-on-primary" onClick={signOut}>
          ログアウト
        </button>
      </header>

      {!online && (
        <div className="notice-bar" role="status">
          インターネットに繋がっていません。繋がると送信できるようになります。
        </div>
      )}

      {notice !== null && online && (
        <div className="notice-bar" role="status">
          {notice}
        </div>
      )}

      <div className="app-body">
        <div className={`list-pane ${showPanel ? 'pane-hidden' : ''}`}>
          <div className="list-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => void refresh()}
              disabled={busy}
            >
              {busy ? '読み込み中…' : '更新'}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setShowAddContact(true)}
            >
              相手を追加
            </button>
          </div>

          {busy && progress?.phase === 'fetching' && (
            <p className="list-empty">
              {progress.fetched} / {progress.total} 件を読み込んでいます…
            </p>
          )}

          <div className="list-scroll">
            <ConversationList
              panels={panels}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          </div>
        </div>

        <div className={`panel-pane ${showPanel ? '' : 'pane-hidden'}`}>
          {selected === null ? (
            <div className="empty-state">
              <p>左の一覧から相手を選ぶと、やり取りが表示されます。</p>
            </div>
          ) : (
            <>
              <div className="panel-header">
                <button
                  type="button"
                  className="button-secondary only-narrow"
                  onClick={() => setSelectedKey(null)}
                >
                  ← 戻る
                </button>
                <span className="panel-peer">{peerLabel(selected.peer)}</span>
                {selected.peerIsRakurakuUser && (
                  <span className="panel-badge">らくらくメール利用中</span>
                )}
              </div>

              <MessageList
                messages={selected.messages}
                onRetry={(message) => handleRetry(message, selected)}
              />

              <Composer
                disabled={sending || !online}
                onSend={(text) => void handleSend(text, selected)}
              />
            </>
          )}
        </div>
      </div>

      {showAddContact && (
        <AddContactForm
          existingEmails={panels.map((p) => p.peer.email)}
          onAdd={handleAddContact}
          onCancel={() => setShowAddContact(false)}
        />
      )}
    </div>
  );
}
