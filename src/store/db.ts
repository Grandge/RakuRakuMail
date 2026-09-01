/**
 * IndexedDB への読み書き（要件定義書 4.3 第1段階 / D-49 / D-61）。
 *
 * M1 で保存するのは `Account`（自分）と `Contact`（相手）だけ。
 * 会話とメッセージは保存せず、毎回 Gmail から組み立て直す（D-48）。
 * アクセストークンは保存しない。メモリ上だけに置く（D-54）。
 *
 * 値は Device Key で暗号化して入れるので、DevTools で覗いても
 * バイト列にしか見えない。鍵そのものは `extractable: false` の
 * CryptoKey として構造化複製で保存するため、JavaScript からは
 * 鍵素材を取り出せない。
 *
 * **保存が壊れていてもアプリは起動する。** 読めなければ「何も保存されて
 * いない」として扱い、書けなければ警告を出して先へ進む（6.3）。
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Account, Contact } from '../domain/types';
import { decryptJson, encryptJson, type Encrypted } from './crypto';
import { loadOrCreateDeviceKey, type KeyVault } from './deviceKey';
import { log } from '../lib/log';

const DB_NAME = 'rakurakumail';
const DB_VERSION = 1;

/** 鍵の置き場。値は CryptoKey そのもの（構造化複製で入る）。 */
const KEY_STORE = 'keys';
const DEVICE_KEY_ID = 'device';

/** 暗号化した設定の置き場。 */
const SETTINGS_STORE = 'settings';
const ACCOUNT_ID = 'account';
const CONTACTS_ID = 'contacts';

interface RakurakuDB extends DBSchema {
  [KEY_STORE]: { key: string; value: CryptoKey };
  [SETTINGS_STORE]: { key: string; value: Encrypted };
}

let connection: Promise<IDBPDatabase<RakurakuDB>> | null = null;

function connect(): Promise<IDBPDatabase<RakurakuDB>> {
  connection ??= openDB<RakurakuDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    },
    // 別のタブが新しい版を開いたら、こちらは閉じて次回つなぎ直す。
    blocking() {
      void connection?.then((db) => db.close());
      connection = null;
    },
  });
  return connection;
}

let deviceKey: Promise<CryptoKey> | null = null;

function keyOf(db: IDBPDatabase<RakurakuDB>): KeyVault {
  return {
    read: () => db.get(KEY_STORE, DEVICE_KEY_ID),
    write: async (key) => {
      await db.put(KEY_STORE, key, DEVICE_KEY_ID);
    },
  };
}

async function getDeviceKey(): Promise<CryptoKey> {
  deviceKey ??= connect().then((db) => loadOrCreateDeviceKey(keyOf(db)));
  return await deviceKey;
}

/** 起動時に読み出す設定一式。読めなかったものは「無い」として返す。 */
export type StoredSettings = {
  account: Account | null;
  contacts: Contact[];
};

const EMPTY: StoredSettings = { account: null, contacts: [] };

/**
 * 保存してある設定を読む。
 *
 * IndexedDB が使えない・中身が壊れている・鍵が変わって復号できない、
 * のいずれでも例外にせず空を返す（Step 8 の確認4）。
 */
export async function loadSettings(): Promise<StoredSettings> {
  try {
    const db = await connect();
    const key = await getDeviceKey();
    const [accountRow, contactsRow] = await Promise.all([
      db.get(SETTINGS_STORE, ACCOUNT_ID),
      db.get(SETTINGS_STORE, CONTACTS_ID),
    ]);

    return {
      account: accountRow ? await decryptJson<Account>(key, accountRow) : null,
      contacts: (contactsRow ? await decryptJson<Contact[]>(key, contactsRow) : null) ?? [],
    };
  } catch (e) {
    log.warn('保存した設定を読めませんでした。初期状態から始めます', e);
    return EMPTY;
  }
}

async function put(id: string, value: unknown): Promise<void> {
  const db = await connect();
  const key = await getDeviceKey();
  await db.put(SETTINGS_STORE, await encryptJson(key, value), id);
}

/**
 * 自分のアカウントを保存する。
 * 保存できなくても画面は動かせるので、例外にせず警告だけ出す。
 */
export async function saveAccount(account: Account): Promise<void> {
  try {
    await put(ACCOUNT_ID, account);
  } catch (e) {
    log.warn('アカウントを保存できませんでした', e);
  }
}

/** 相手の一覧をまとめて保存する（件数が少ないので差分は取らない）。 */
export async function saveContacts(contacts: readonly Contact[]): Promise<void> {
  try {
    await put(CONTACTS_ID, contacts);
  } catch (e) {
    log.warn('相手の一覧を保存できませんでした', e);
  }
}

/**
 * 端末に残した設定を消す（要件定義書 6.2 / D-55 / PER-05）。鍵ごと捨てる。
 *
 * **呼ぶのは S-07 設定画面の「この端末のデータを消す」だけ。**
 * ログアウトでは消さない。M3 の複数アカウント切り替え（D-36）で
 * 切り替えのたびに相手の一覧が消えてしまうため。
 * 破壊的な操作なので、呼ぶ側で確認画面を挟むこと（5.4）。
 * M1 では設定画面が無いので、まだどこからも呼んでいない。
 */
export async function clearAll(): Promise<void> {
  try {
    const db = await connect();
    await Promise.all([db.clear(SETTINGS_STORE), db.clear(KEY_STORE)]);
  } catch (e) {
    log.warn('保存した設定を消せませんでした', e);
  } finally {
    deviceKey = null;
  }
}
