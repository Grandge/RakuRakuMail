/**
 * データ構造（要件定義書 4.2）。
 *
 * メッセージ本体は永続化しない。Gmail から取得したものをメモリ上に持つだけで、
 * アプリを閉じれば消え、次回起動時に再取得する（D-48）。
 */

export type Account = {
  id: string;
  email: string;
  /** 送信時の差出人名にも使う。sendAs / userinfo から自動取得する（D-64）。 */
  displayName: string;
  /** M2 で作る。M1 では空。 */
  labelIds: { main: string; reaction: string } | null;
  filterIds: string[];
  /** 差分同期の起点（M2 で使う）。 */
  lastHistoryId: string | null;
  /** 初回取込範囲（D-45）。 */
  importRange: ImportRange;
};

export type ImportRange = '1m' | '3m' | '1y' | 'all';

export type Contact = {
  id: string;
  accountId: string;
  /** アドレスごとに別の相手として扱う（D-37。名寄せしない）。 */
  email: string;
  displayName: string;
  /** 独自ヘッダ付きのメールを一度でも受け取ったか（3.9）。 */
  isRakurakuUser: boolean;
};

export type Group = {
  id: string;
  accountId: string;
  name: string;
  members: { email: string; displayName: string }[];
  rosterVersion: number;
  createdByEmail: string;
};

export type Conversation = {
  /** 会話ID（独自ヘッダに載せる）。 */
  id: string;
  accountId: string;
  kind: 'direct' | 'group';
  /** Contact.id または Group.id。 */
  targetId: string;
  /** 会話を通じて変えない（3.4 / D-59）。 */
  subject: string;
  /**
   * 長いスレッドの分割に対応するため配列で持つ（3.6）。
   * M1 では常に1件だが、単数で作ると後で全面的に触ることになる。
   */
  threadIds: string[];
  /** In-Reply-To に使う RFC822 の Message-ID。Gmail 内部IDではない。 */
  lastMessageId: string | null;
  lastActivityAt: string;
};

/** 画面に並べる1件。Gmail から組み立てる。永続化しない。 */
export type Message = {
  /** Gmail の内部ID。 */
  gmailId: string;
  threadId: string;
  /** RFC822 の Message-ID。 */
  rfcMessageId: string | null;
  /** 自分の発言か（右詰めにするか / D-25）。 */
  isMine: boolean;
  from: { email: string; displayName: string };
  to: { email: string; displayName: string }[];
  sentAt: string;
  /** フッタと引用を落とした本文。 */
  text: string;
  /**
   * 独自ヘッダ。M1 では読み取るだけで使わないが、
   * M2 の削除連携・M4 のリアクションで必要になるので器を用意しておく。
   */
  rakuraku: RakurakuHeaderSet | null;
};

/** 独自ヘッダ（要件定義書 3.3）。 */
export type RakurakuType = 'message' | 'reaction' | 'system';

export type RakurakuMeta = {
  sender: { name: string };
  group?: {
    name: string;
    rosterVersion: number;
    members: { email: string; name: string }[];
  };
  reaction?: { targetMsgId: string; emoji: string };
  images?: { cid: string; name: string }[];
};

export type RakurakuHeaderSet = {
  /** 知らない版でも落とさない（3.3 の版数の扱い）。 */
  version: string;
  type: RakurakuType;
  convId: string;
  msgId: string;
  groupId?: string;
  /** 解釈できなければ null。本文だけ表示する。 */
  meta: RakurakuMeta | null;
};
