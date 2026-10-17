// 運営ページ用:自動取得の実行記録とDB容量(v23・合言葉が必要)
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminOk } from "../../../../lib/adminAuth";

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  if (!adminOk(body.key)) return NextResponse.json({ error: "合言葉が違います" }, { status: 403 });
  if (!process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: "SUPABASE_SECRET_KEY が未設定です" }, { status: 500 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const [usage, runs] = await Promise.all([
    sb.rpc("db_usage").then((r) => r.data).catch(() => null),
    sb.from("collect_runs").select("started_at, slot, store, requests, items, errors, note").order("started_at", { ascending: false }).limit(30).then((r) => r.data || []).catch(() => []),
  ]);
  return NextResponse.json({ usage, runs });
}
