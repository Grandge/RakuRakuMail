/** 開発時のみ出力するログ。本番ビルドでは黙る。 */
const enabled = import.meta.env.DEV;

export const log = {
  debug(...args: unknown[]): void {
    if (enabled) console.debug('[らくらくメール]', ...args);
  },
  warn(...args: unknown[]): void {
    if (enabled) console.warn('[らくらくメール]', ...args);
  },
  error(...args: unknown[]): void {
    console.error('[らくらくメール]', ...args);
  },
};
