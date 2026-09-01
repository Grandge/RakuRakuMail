import { describe, expect, it } from 'vitest';
import { buildImportQuery, toConversation, toMessage } from './importer';
import { bytesToBase64url, utf8ToBytes } from '../mail/base64url';
import { buildRakurakuHeaders } from '../mail/headers';
import type { GmailMessage, GmailPart } from '../mail/parse';

const ME = 'taro@example.com';
const PEER = 'hanako@example.com';

function body(text: string): GmailPart {
  return {
    mimeType: 'text/plain',
    headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
    body: { data: bytesToBase64url(utf8ToBytes(text)) },
  };
}

function mail(options: {
  id: string;
  from: string;
  to: string;
  text: string;
  subject?: string;
  date?: string;
  rakuraku?: boolean;
  messageId?: string;
}): GmailMessage {
  const headers = [
    { name: 'From', value: options.from },
    { name: 'To', value: options.to },
    { name: 'Subject', value: options.subject ?? '=?UTF-8?B?44KJ44GP44KJ44GP44Oh44O844Or?=' },
    { name: 'Message-ID', value: options.messageId ?? `<${options.id}@mail.gmail.com>` },
  ];
  if (options.rakuraku === true) {
    const extra = buildRakurakuHeaders({
      type: 'message',
      convId: 'conv-1',
      msgId: `msg-${options.id}`,
      meta: { sender: { name: '芝直之' } },
    });
    for (const [name, value] of Object.entries(extra)) headers.push({ name, value });
  }

  return {
    id: options.id,
    threadId: 'thread-1',
    internalDate: String(Date.parse(options.date ?? '2026-09-01T10:00:00Z')),
    payload: { ...body(options.text), headers: [...headers, ...(body('').headers ?? [])] },
  };
}

describe('buildImportQuery', () => {
  it('目印と in:anywhere と期間を組み合わせる', () => {
    expect(buildImportQuery('1m')).toBe('"rakurakumail" in:anywhere newer_than:1m');
  });

  it('all のときは期間を付けない', () => {
    expect(buildImportQuery('all')).toBe('"rakurakumail" in:anywhere');
  });
});

describe('toMessage', () => {
  it('自分が送ったメールを isMine にする（右詰めの判定 / D-25）', () => {
    const message = toMessage(
      mail({ id: '1', from: `芝直之 <${ME}>`, to: PEER, text: '本文' }),
      ME,
    );
    expect(message.isMine).toBe(true);
  });

  it('相手からのメールは isMine にしない', () => {
    const message = toMessage(mail({ id: '1', from: PEER, to: ME, text: '本文' }), ME);
    expect(message.isMine).toBe(false);
  });

  it('アドレスの大小を区別しない', () => {
    const message = toMessage(
      mail({ id: '1', from: 'Taro@Example.com', to: PEER, text: '本文' }),
      ME,
    );
    expect(message.isMine).toBe(true);
  });

  it('差出人の表示名を復号する', () => {
    const message = toMessage(
      mail({ id: '1', from: `=?UTF-8?B?6Iqd55u05LmL?= <${ME}>`, to: PEER, text: '本文' }),
      ME,
    );
    expect(message.from.displayName).toBe('芝直之');
  });

  it('本文からフッタを落とす', () => {
    const text = '明日の10時でお願いします\n\n--\nらくらくメール rakurakumail より送信\n';
    const message = toMessage(mail({ id: '1', from: ME, to: PEER, text }), ME);
    expect(message.text).toBe('明日の10時でお願いします');
  });

  it('本文から引用を落とす（目印の無い返信 / D-19）', () => {
    const text = [
      '承知しました',
      '',
      '2026年9月1日(月) 12:34 芝直之 <taro@example.com>:',
      '',
      '> 明日の10時でお願いします',
      '> --',
      '> らくらくメール rakurakumail より送信',
    ].join('\n');
    const message = toMessage(mail({ id: '2', from: PEER, to: ME, text }), ME);
    expect(message.text).toBe('承知しました');
  });

  it('RFC822 の Message-ID を拾う', () => {
    const message = toMessage(
      mail({ id: '1', from: ME, to: PEER, text: '本文', messageId: '<abc@mail.gmail.com>' }),
      ME,
    );
    expect(message.rfcMessageId).toBe('<abc@mail.gmail.com>');
  });

  it('独自ヘッダがあれば読み取る', () => {
    const message = toMessage(
      mail({ id: '1', from: ME, to: PEER, text: '本文', rakuraku: true }),
      ME,
    );
    expect(message.rakuraku?.convId).toBe('conv-1');
  });

  it('独自ヘッダが無ければ null（普通のメールからの返信）', () => {
    const message = toMessage(mail({ id: '1', from: PEER, to: ME, text: '本文' }), ME);
    expect(message.rakuraku).toBeNull();
  });

  it('internalDate から送信時刻を取る', () => {
    const message = toMessage(
      mail({ id: '1', from: ME, to: PEER, text: '本文', date: '2026-09-01T01:23:45Z' }),
      ME,
    );
    expect(message.sentAt).toBe('2026-09-01T01:23:45.000Z');
  });
});

describe('toConversation', () => {
  const sent = mail({
    id: '1',
    from: `芝直之 <${ME}>`,
    to: PEER,
    text: '明日の10時でお願いします\n\n--\nらくらくメール rakurakumail より送信',
    date: '2026-09-01T10:00:00Z',
    rakuraku: true,
  });

  // 目印も独自ヘッダも無い、Gmail の画面からの普通の返信
  const reply = mail({
    id: '2',
    from: `山田花子 <${PEER}>`,
    to: ME,
    text: '承知しました\n\n> 明日の10時でお願いします',
    date: '2026-09-01T11:00:00Z',
  });

  it('目印の無い返信も同じ会話に取り込む（D-19 の核心）', () => {
    const conversation = toConversation('thread-1', [sent, reply], ME);
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[1]?.text).toBe('承知しました');
  });

  it('時刻の順に並べる', () => {
    const conversation = toConversation('thread-1', [reply, sent], ME);
    expect(conversation?.messages[0]?.gmailId).toBe('1');
    expect(conversation?.messages[1]?.gmailId).toBe('2');
  });

  it('自分を除いた相手を拾う', () => {
    const conversation = toConversation('thread-1', [sent, reply], ME);
    expect(conversation?.peers).toEqual([{ email: PEER, displayName: '山田花子' }]);
  });

  it('件名を復号して持つ', () => {
    const conversation = toConversation('thread-1', [sent, reply], ME);
    expect(conversation?.subject).toBe('らくらくメール');
  });

  it('独自ヘッダから会話IDを拾う', () => {
    const conversation = toConversation('thread-1', [sent, reply], ME);
    expect(conversation?.convId).toBe('conv-1');
  });

  it('相手が独自ヘッダを送ってきていなければ未利用者と判定する（3.9）', () => {
    const conversation = toConversation('thread-1', [sent, reply], ME);
    expect(conversation?.peerIsRakurakuUser).toBe(false);
  });

  it('相手が独自ヘッダ付きで返してきたら利用者と判定する', () => {
    const rakurakuReply = mail({
      id: '3',
      from: PEER,
      to: ME,
      text: '了解',
      date: '2026-09-01T12:00:00Z',
      rakuraku: true,
    });
    const conversation = toConversation('thread-1', [sent, rakurakuReply], ME);
    expect(conversation?.peerIsRakurakuUser).toBe(true);
  });

  it('最後のメッセージの時刻を lastActivityAt にする', () => {
    const conversation = toConversation('thread-1', [sent, reply], ME);
    expect(conversation?.lastActivityAt).toBe('2026-09-01T11:00:00.000Z');
  });

  it('空のスレッドは null', () => {
    expect(toConversation('thread-1', [], ME)).toBeNull();
  });

  it('自分から自分へのメールでも相手が空にならず落ちない', () => {
    const self = mail({ id: '9', from: ME, to: ME, text: '自分宛て' });
    const conversation = toConversation('thread-1', [self], ME);
    expect(conversation?.peers).toEqual([]);
    expect(conversation?.messages).toHaveLength(1);
  });
});
