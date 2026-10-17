// サーバー(商品ページ・サイトマップ)から読むための Supabase(読み取り専用の公開キー)
import { createClient } from "@supabase/supabase-js";

export function publicDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const SITE = (process.env.SITE_ORIGIN || "https://oudan.vercel.app").replace(/\/$/, "");

// Yahoo!のリンクにバリューコマースを付ける(自動取得で付いていない場合の保険)
export function ensureAffiliate(store, url) {
  if (!url) return url;
  if (store === "yahoo" && !/valuecommerce\.com/.test(url) && process.env.VC_SID && process.env.VC_PID) {
    return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${process.env.VC_SID}&pid=${process.env.VC_PID}&vc_url=${encodeURIComponent(url)}`;
  }
  if (store === "amazon") {
    try { const u = new URL(url); u.searchParams.set("tag", process.env.AMAZON_PARTNER_TAG || "popo-kaiteki-22"); return u.toString(); } catch {}
  }
  return url;
}
