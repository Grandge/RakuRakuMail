/**
 * 返信の引用部分を落とす（M1実装計画 詰まりどころ #13）。
 *
 * 相手が Gmail の画面から返信すると、元のやり取りが丸ごと引用として
 * 本文に入ってくる。そのまま表示すると吹き出しが過去ログだらけになる。
 *
 * **完全を目指さない。** メールソフトごとに引用の形が違うため、
 * Gmail（ウェブ版・スマホアプリ）と Outlook の形だけを相手にし、
 * 残りは許容する（D-21 と同じ考え方）。
 *
 * 方針: 引用の始まりに見える最初の行を探し、そこから後ろを丸ごと落とす。
 */

/** 引用の始まりを示す行の型。 */
const ATTRIBUTION_PATTERNS: readonly RegExp[] = [
  // Gmail 日本語: 「2026年9月1日(月) 12:34 芝直之 <taro@example.com>:」
  /^\s*\d{4}年\d{1,2}月\d{1,2}日\([日月火水木金土]\)\s.*[:：]\s*$/,
  // 日付だけで曜日が無い形も拾う
  /^\s*\d{4}年\d{1,2}月\d{1,2}日.*<[^>]+@[^>]+>.*[:：]\s*$/,
  // Gmail 英語: 「On Mon, Sep 1, 2026 at 12:34 PM Name <a@b> wrote:」
  /^\s*On\s.+\swrote:\s*$/i,
  // Outlook 英語
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
  // Outlook 日本語
  /^\s*-{2,}\s*(元のメッセージ|転送されたメッセージ)\s*-{2,}\s*$/,
  /^\s*(差出人|送信者)\s*[:：]\s*.+$/,
  // Outlook の区切り線（全角アンダースコアの並び）
  /^\s*_{10,}\s*$/,
  // Apple Mail 日本語
  /^\s*\d{4}\/\d{1,2}\/\d{1,2}\s.*メール[:：]?\s*$/,
];

function isAttribution(line: string): boolean {
  return ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(line));
}

function isQuoted(line: string): boolean {
  return /^\s*>/.test(line);
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/**
 * 引用を落とした本文を返す。
 * 引用が見つからなければ、末尾の空白だけ落として返す。
 */
export function stripQuotedReply(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const cut = findQuoteStart(lines);
  if (cut === null) return normalized.replace(/\s+$/, '');

  return lines.slice(0, cut).join('\n').replace(/\s+$/, '');
}

/** 引用が始まる行番号。見つからなければ null。 */
function findQuoteStart(lines: readonly string[]): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;

    // 引用の見出し行。ここから後ろは引用とみなす。
    if (isAttribution(line)) return trimBlankLinesBefore(lines, i);

    // `>` で始まる行が現れ、そこから末尾まで引用と空行しか無ければ引用の塊。
    if (isQuoted(line) && restIsQuoteOnly(lines, i)) {
      return trimBlankLinesBefore(lines, i);
    }
  }
  return null;
}

function restIsQuoteOnly(lines: readonly string[], from: number): boolean {
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!isQuoted(line) && !isBlank(line)) return false;
  }
  return true;
}

/** 引用の直前にある空行も一緒に落とす。 */
function trimBlankLinesBefore(lines: readonly string[], index: number): number {
  let cut = index;
  while (cut > 0) {
    const previous = lines[cut - 1];
    if (previous === undefined || !isBlank(previous)) break;
    cut -= 1;
  }
  return cut;
}
