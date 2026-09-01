import { describe, expect, it } from 'vitest';
import {
  applySendResult,
  conversationForSend,
  mergePanels,
  panelForNewContact,
  panelsFromConversations,
  peerLabel,
  settleMessage,
  type Panel,
  type PanelMessage,
} from './panel';
import type { ConversationView } from './importer';
import type { Message } from './types';

const ME_NAME = '芝直之';
const PEER = 'hanako@example.com';
const OTHER = 'jiro@example.com';

function message(overrides: Partial<Message> = {}): Message {
  return {
    gmailId: 'm1',
    threadId: 't1',
    rfcMessageId: '<m1@mail.gmail.com>',
    isMine: true,
    from: { email: 'taro@example.com', displayName: ME_NAME },
    to: [{ email: PEER, displayName: 'やさび' }],
    sentAt: '2026-09-01T10:00:00.000Z',
    text: '本文',
    rakuraku: null,
    ...overrides,
  };
}

function view(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    threadId: 't1',
    convId: 'conv-1',
    subject: 'らくらくメール（芝直之）',
    peers: [{ email: PEER, displayName: 'やさび' }],
    peerIsRakurakuUser: false,
    messages: [message()],
    lastActivityAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('panelsFromConversations', () => {
  it('相手ごとに1つのパネルにする（SND-01）', () => {
    const panels = panelsFromConversations([view()], ME_NAME);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.key).toBe(PEER);
  });

  it('同じ相手の複数スレッドを1つのパネルにまとめる', () => {
    const first = view({ threadId: 't1', lastActivityAt: '2026-09-01T10:00:00.000Z' });
    const second = view({
      threadId: 't2',
      subject: 'らくらくメール（やさび）',
      lastActivityAt: '2026-09-01T12:00:00.000Z',
      messages: [message({ gmailId: 'm2', threadId: 't2', sentAt: '2026-09-01T12:00:00.000Z' })],
    });

    const panels = panelsFromConversations([first, second], ME_NAME);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.threads).toHaveLength(2);
    expect(panels[0]?.messages).toHaveLength(2);
  });

  it('まとめたスレッドは新しい順に並ぶ（継続送信は先頭を継ぐ）', () => {
    const older = view({ threadId: 't-old', lastActivityAt: '2026-09-01T09:00:00.000Z' });
    const newer = view({ threadId: 't-new', lastActivityAt: '2026-09-01T18:00:00.000Z' });
    const panels = panelsFromConversations([older, newer], ME_NAME);
    expect(panels[0]?.threads[0]?.threadId).toBe('t-new');
  });

  it('まとめたメッセージは時刻の順に並ぶ', () => {
    const a = view({
      threadId: 't1',
      messages: [message({ gmailId: 'later', sentAt: '2026-09-01T15:00:00.000Z' })],
      lastActivityAt: '2026-09-01T15:00:00.000Z',
    });
    const b = view({
      threadId: 't2',
      messages: [message({ gmailId: 'earlier', sentAt: '2026-09-01T09:00:00.000Z' })],
      lastActivityAt: '2026-09-01T09:00:00.000Z',
    });
    const panels = panelsFromConversations([a, b], ME_NAME);
    expect(panels[0]?.messages.map((m) => m.gmailId)).toEqual(['earlier', 'later']);
  });

  it('アドレスが違えば別のパネルにする（D-37。名寄せしない）', () => {
    const one = view({ threadId: 't1', peers: [{ email: PEER, displayName: 'やさび' }] });
    const two = view({ threadId: 't2', peers: [{ email: OTHER, displayName: 'SIVA' }] });
    const panels = panelsFromConversations([one, two], ME_NAME);
    expect(panels).toHaveLength(2);
  });

  it('アドレスの大小の違いは同じ相手として扱う', () => {
    const one = view({ threadId: 't1', peers: [{ email: PEER, displayName: 'やさび' }] });
    const two = view({
      threadId: 't2',
      peers: [{ email: PEER.toUpperCase(), displayName: '' }],
    });
    expect(panelsFromConversations([one, two], ME_NAME)).toHaveLength(1);
  });

  it('どれか1本でも相手が独自ヘッダを送っていれば利用者と判定する（3.9）', () => {
    const plain = view({ threadId: 't1', peerIsRakurakuUser: false });
    const rakuraku = view({ threadId: 't2', peerIsRakurakuUser: true });
    expect(panelsFromConversations([plain, rakuraku], ME_NAME)[0]?.peerIsRakurakuUser).toBe(
      true,
    );
  });

  it('相手を特定できないスレッドは出さない', () => {
    expect(panelsFromConversations([view({ peers: [] })], ME_NAME)).toEqual([]);
  });

  it('新しいやり取りの順に並べる', () => {
    const old = view({
      threadId: 't1',
      peers: [{ email: PEER, displayName: 'やさび' }],
      lastActivityAt: '2026-09-01T09:00:00.000Z',
    });
    const recent = view({
      threadId: 't2',
      peers: [{ email: OTHER, displayName: 'SIVA' }],
      lastActivityAt: '2026-09-01T20:00:00.000Z',
    });
    expect(panelsFromConversations([old, recent], ME_NAME)[0]?.key).toBe(OTHER);
  });
});

describe('conversationForSend', () => {
  it('スレッドがあれば一番新しいものを継ぐ', () => {
    const panels = panelsFromConversations(
      [
        view({ threadId: 't-old', lastActivityAt: '2026-09-01T09:00:00.000Z' }),
        view({
          threadId: 't-new',
          subject: '件名B',
          lastActivityAt: '2026-09-01T18:00:00.000Z',
        }),
      ],
      ME_NAME,
    );
    const conversation = conversationForSend(panels[0] as Panel);
    expect(conversation.threadIds).toEqual(['t-new']);
    expect(conversation.subject).toBe('件名B');
  });

  it('まだ1通も送っていなければ新規の件名で始める（3.4 / D-59）', () => {
    const panel = panelForNewContact({
      peer: { email: PEER, displayName: 'やさび' },
      myDisplayName: ME_NAME,
    });
    const conversation = conversationForSend(panel);
    expect(conversation.threadIds).toEqual([]);
    expect(conversation.subject).toBe('らくらくメール（芝直之）');
    expect(conversation.lastMessageId).toBeNull();
  });
});

describe('applySendResult', () => {
  it('送ったスレッドを先頭に持ってくる', () => {
    const panel = panelForNewContact({
      peer: { email: PEER, displayName: 'やさび' },
      myDisplayName: ME_NAME,
    });
    const updated = applySendResult(panel, {
      threadId: 't-new',
      rfcMessageId: '<x@mail.gmail.com>',
      sentAt: '2026-09-01T20:00:00.000Z',
    });
    expect(updated.threads[0]?.threadId).toBe('t-new');
    expect(updated.threads[0]?.lastMessageId).toBe('<x@mail.gmail.com>');
    expect(updated.lastActivityAt).toBe('2026-09-01T20:00:00.000Z');
  });

  it('同じスレッドへの続き送信でスレッドが増えない', () => {
    const panels = panelsFromConversations([view({ threadId: 't1' })], ME_NAME);
    const updated = applySendResult(panels[0] as Panel, {
      threadId: 't1',
      rfcMessageId: '<y@mail.gmail.com>',
      sentAt: '2026-09-01T20:00:00.000Z',
    });
    expect(updated.threads).toHaveLength(1);
    expect(updated.threads[0]?.lastMessageId).toBe('<y@mail.gmail.com>');
  });

  it('Message-ID が取れなかったら前の値を残す', () => {
    const panels = panelsFromConversations([view({ threadId: 't1' })], ME_NAME);
    const before = panels[0]?.threads[0]?.lastMessageId;
    const updated = applySendResult(panels[0] as Panel, {
      threadId: 't1',
      rfcMessageId: null,
      sentAt: '2026-09-01T20:00:00.000Z',
    });
    expect(updated.threads[0]?.lastMessageId).toBe(before);
  });
});

describe('mergePanels', () => {
  it('取り込めた内容で入れ替える', () => {
    const before = panelForNewContact({
      peer: { email: PEER, displayName: 'やさび' },
      myDisplayName: ME_NAME,
    });
    const imported = panelsFromConversations([view()], ME_NAME);
    const merged = mergePanels([before], imported);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.messages).toHaveLength(1);
  });

  it('送信中の吹き出しは取り込みで消えない', () => {
    const pending: PanelMessage = { ...message({ gmailId: 'local-1' }), pending: 'sending' };
    const before: Panel = {
      ...panelForNewContact({
        peer: { email: PEER, displayName: 'やさび' },
        myDisplayName: ME_NAME,
      }),
      messages: [pending],
    };
    const merged = mergePanels([before], panelsFromConversations([view()], ME_NAME));
    expect(merged[0]?.messages.some((m) => m.gmailId === 'local-1')).toBe(true);
  });

  it('まだ1通も送っていない相手は残る', () => {
    const draft = panelForNewContact({
      peer: { email: OTHER, displayName: 'SIVA' },
      myDisplayName: ME_NAME,
    });
    const merged = mergePanels([draft], panelsFromConversations([view()], ME_NAME));
    expect(merged.map((p) => p.key).sort()).toEqual([OTHER, PEER].sort());
  });

  it('取り込みで表示名が空なら、前に持っていた名前を残す', () => {
    const before: Panel = {
      ...panelForNewContact({
        peer: { email: PEER, displayName: '手で付けた名前' },
        myDisplayName: ME_NAME,
      }),
    };
    const imported = panelsFromConversations(
      [view({ peers: [{ email: PEER, displayName: '' }] })],
      ME_NAME,
    );
    expect(mergePanels([before], imported)[0]?.peer.displayName).toBe('手で付けた名前');
  });
});

describe('settleMessage', () => {
  it('送信中の印を外す', () => {
    const pending: PanelMessage = {
      ...message({ gmailId: 'local-1' }),
      pending: 'sending',
      draftText: '本文',
    };
    const settled = settleMessage(pending, { gmailId: 'real-1' });
    expect(settled.gmailId).toBe('real-1');
    expect('pending' in settled).toBe(false);
    expect('draftText' in settled).toBe(false);
  });
});

describe('peerLabel', () => {
  it('表示名があればそれを使う', () => {
    expect(peerLabel({ email: PEER, displayName: 'やさび' })).toBe('やさび');
  });

  it('表示名が無ければアドレスを使う', () => {
    expect(peerLabel({ email: PEER, displayName: '  ' })).toBe(PEER);
  });
});
