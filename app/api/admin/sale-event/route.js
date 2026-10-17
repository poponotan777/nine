import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminOk } from "../../../../lib/adminAuth";

// セール確定日程の登録(運営者専用)
// /crawl の管理フォームから呼ばれる。合言葉(NEXT_PUBLIC_CRAWL_KEY)で保護
export async function POST(request) {
  try {
    const { key, name, store, start_date, end_date, url } = await request.json();
    // v23: 合言葉はサーバー専用の ADMIN_KEY で確認(未設定なら旧 NEXT_PUBLIC_CRAWL_KEY)
    if (!adminOk(key)) {
      return NextResponse.json({ error: "合言葉が違います" }, { status: 403 });
    }
    if (!name || !store || !start_date) {
      return NextResponse.json({ error: "name / store / start_date は必須です" }, { status: 400 });
    }
    if (!["rakuten", "yahoo", "amazon"].includes(store)) {
      return NextResponse.json({ error: "storeは rakuten / yahoo / amazon のいずれか" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || (end_date && !/^\d{4}-\d{2}-\d{2}$/.test(end_date))) {
      return NextResponse.json({ error: "日付は YYYY-MM-DD 形式で" }, { status: 400 });
    }
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
    );
    const { error } = await admin.from("sale_events").insert({
      name: String(name).slice(0, 60),
      store,
      start_date,
      end_date: end_date || null,
      url: url ? String(url).slice(0, 300) : null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }
}
