// 管理用の合言葉チェック(v21)
//   Vercel の環境変数 ADMIN_KEY(ブラウザには配られない)を優先。
//   未設定のあいだは、従来の NEXT_PUBLIC_CRAWL_KEY でも通す(移行期間用)。
import { timingSafeEqual } from "node:crypto";

export function adminKeyConfigured() {
  return !!(process.env.ADMIN_KEY || process.env.NEXT_PUBLIC_CRAWL_KEY);
}

export function adminOk(key) {
  const want = process.env.ADMIN_KEY || process.env.NEXT_PUBLIC_CRAWL_KEY || "";
  if (!want || typeof key !== "string" || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
