import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages のプロジェクトサイトで配信するため base を付ける（D-63）。
// リポジトリ名の大文字小文字は URL 上で区別される。
// 配信先: https://grandge.github.io/RakuRakuMail/
export default defineConfig({
  base: '/RakuRakuMail/',
  plugins: [react()],
  server: {
    // OAuth の「承認済みの JavaScript 生成元」に登録した値と
    // 完全に一致させる必要がある（M1実装計画 6節 #1）。
    //
    // ホストを 127.0.0.1 に固定する理由:
    // Google Cloud Console の「クライアント」画面が http://localhost:5173 を
    // 「末尾はパブリック トップレベル ドメインにする必要があります」と拒否するため、
    // 生成元には http://127.0.0.1:5173 を登録している。
    // ブラウザの origin は入力したホスト名がそのまま使われるので、
    // localhost で開くと別オリジンになり origin_mismatch になる。
    // 開発時は必ず http://127.0.0.1:5173/RakuRakuMail/ を開くこと。
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
