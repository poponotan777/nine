// 商品まとめの管理API(v21)— 運営だけが使う(合言葉が必要)
//   action: list / get / save / delete
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { adminOk } from "../../../../lib/adminAuth";
import { makeSlug } from "../../../../lib/affiliate";

const TEMPLATES = ["ranking", "lineup", "compare"];
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

// 作成時の3サイト価格をDBから取る(統合済みのキーは統合先に直す)
async function snapshotPrices(sb, keys) {
  const out = {};
  if (!keys.length) return out;
  const { data: prods } = await sb.from("products").select("pkey, merged_into, image, name").in("pkey", keys);
  const canon = {};
  for (const p of prods || []) canon[p.pkey] = p.merged_into || p.pkey;
  const targets = [...new Set(keys.map((k) => canon[k] || k))];
  const { data: offers } = await sb.from("offers").select("pkey, store, price, updated_at").in("pkey", targets);
  for (const k of keys) {
    const t = canon[k] || k;
    const prices = { rakuten: null, yahoo: null, amazon: null };
    for (const o of (offers || []).filter((x) => x.pkey === t)) prices[o.store] = o.price;
    out[k] = { key: t, prices };
  }
  return out;
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 }); }
  if (!adminOk(body?.key)) return NextResponse.json({ error: "合言葉が違います" }, { status: 403 });
  if (!process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: "SUPABASE_SECRET_KEY が未設定です" }, { status: 500 });
  const sb = admin();
  const action = body.action;

  if (action === "list") {
    const { data, error } = await sb.from("collections").select("id, slug, title, subtitle, template, is_public, created_at, updated_at").order("updated_at", { ascending: false }).limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ collections: data || [] });
  }

  if (action === "get") {
    const { data: col } = await sb.from("collections").select("*").eq("id", body.id).maybeSingle();
    if (!col) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    const { data: items } = await sb.from("collection_items").select("position, product_key, name, image, headline, comment, prices, snapshot_at").eq("collection_id", col.id).order("position");
    return NextResponse.json({ collection: col, items: items || [] });
  }

  if (action === "delete") {
    const { data: col } = await sb.from("collections").select("slug").eq("id", body.id).maybeSingle();
    await sb.from("collections").delete().eq("id", body.id);
    if (col?.slug) revalidatePath(`/c/${col.slug}`);
    revalidatePath("/c");
    return NextResponse.json({ ok: true });
  }

  if (action === "save") {
    const c = body.collection || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const title = txt(c.title, 80);
    if (!title) return NextResponse.json({ error: "タイトルを入れてください" }, { status: 400 });
    if (!TEMPLATES.includes(c.template)) return NextResponse.json({ error: "テンプレートが不正です" }, { status: 400 });
    if (items.length < 2 || items.length > 6) return NextResponse.json({ error: "商品は2〜6個にしてください" }, { status: 400 });
    const keys = items.map((it) => txt(it.product_key, 140)).filter(Boolean);
    if (keys.length !== items.length) return NextResponse.json({ error: "商品キーが不正です" }, { status: 400 });

    const snap = await snapshotPrices(sb, keys);
    const now = new Date().toISOString();
    const row = {
      title,
      subtitle: txt(c.subtitle, 160),
      description: txt(c.description, 1000),
      template: c.template,
      author_name: txt(c.author_name, 40),
      is_public: c.is_public !== false,
      updated_at: now,
    };
    let id = c.id || null;
    let slug = c.slug || null;
    if (id) {
      const { error } = await sb.from("collections").update(row).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      slug = makeSlug();
      const { data, error } = await sb.from("collections").insert({ ...row, slug, published_at: now }).select("id, slug").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      id = data.id; slug = data.slug;
    }
    await sb.from("collection_items").delete().eq("collection_id", id);
    const rows = items.map((it, i) => ({
      collection_id: id,
      position: i,
      product_key: snap[it.product_key]?.key || it.product_key,
      name: txt(it.name, 200) || "商品",
      image: txt(it.image, 400),
      headline: txt(it.headline, 60),
      comment: txt(it.comment, 400),
      prices: snap[it.product_key]?.prices || null,
      snapshot_at: now,
      // 旧版の列(使わないが互換のため):最安値とそのサイト
      price: (() => { const p = snap[it.product_key]?.prices || {}; const v = Object.values(p).filter((x) => x != null); return v.length ? Math.min(...v) : null; })(),
      store: (() => { const p = snap[it.product_key]?.prices || {}; let b = null; for (const s of Object.keys(p)) if (p[s] != null && (b == null || p[s] < p[b])) b = s; return b; })(),
    }));
    const { error: e2 } = await sb.from("collection_items").insert(rows);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    revalidatePath(`/c/${slug}`);
    revalidatePath("/c");
    return NextResponse.json({ ok: true, id, slug });
  }

  return NextResponse.json({ error: "action が不正です" }, { status: 400 });
}
