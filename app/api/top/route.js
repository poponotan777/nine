// トップの「おすすめ・お得・急上昇」(v22)
//   DB(自動取得の結果)から選ぶ。30分ごとに作り直す(見られるたびに外部APIは呼ばない)
import { NextResponse } from "next/server";
import { publicDb } from "../../../lib/supabaseServer";
import { loadCatalog } from "../../../lib/catalog";
import { STORE_ORDER, statsFor, statsLabel } from "../../../lib/priceView";

export const revalidate = 1800;
const PER = 12;

export async function GET() {
  const sb = publicDb();
  const { data, error } = await sb.rpc("top_picks", { _n: 24 });
  if (error) return NextResponse.json({ recommend: [], deal: [], trend: [], error: "not_ready" });

  const rows = data || [];
  const cat = await loadCatalog(sb, [...new Set(rows.map((r) => r.pkey))]).catch(() => new Map());

  const build = (r) => {
    const e = cat.get(r.pkey);
    if (!e || !e.product) return null;
    const offers = {};
    let best = null;
    for (const s of STORE_ORDER) {
      const o = e.offers[s];
      if (!o) continue;
      offers[s] = { price: o.price, point_rate: o.point_rate, sale_label: o.sale_label };
      if (!best || o.price < best.o.price) best = { s, o };
    }
    if (!best) return null;
    // バッジ:お得はそのサイトの中央値との差、それ以外は最安サイトの統計
    const focus = r.kind === "deal" && r.store && e.offers[r.store] ? { s: r.store, o: e.offers[r.store] } : best;
    const st = statsFor(focus.o.price, focus.o);
    const lab = statsLabel(st);
    return {
      pkey: e.pkey,
      name: e.product.name,
      image: e.product.image && !/media-amazon/.test(e.product.image) ? e.product.image : e.product.image || null,
      brand: e.product.brand,
      offers,
      stores: Object.keys(offers).length,
      badge: r.kind === "deal" ? `${focus.s === "rakuten" ? "楽天" : focus.s === "yahoo" ? "Yahoo!" : "Amazon"}で${lab.main}` : r.kind === "trend" ? "🚀 急上昇" : (lab.tone === "good" ? lab.main : "人気"),
      sub: st && st.days >= 7 ? lab.sub : "",
      score: Number(r.score),
    };
  };

  const pick = (kind, sortFn) => {
    const seen = new Set();
    const list = [];
    for (const r of rows.filter((x) => x.kind === kind)) {
      const it = build(r);
      if (!it || seen.has(it.pkey)) continue;
      seen.add(it.pkey);
      list.push(it);
    }
    // 2サイト以上で比べられる商品を優先
    return list.sort(sortFn((a, b) => (b.stores >= 2) - (a.stores >= 2))).slice(0, PER);
  };

  return NextResponse.json({
    deal: pick("deal", (tie) => (a, b) => tie(a, b) || b.score - a.score),
    trend: pick("trend", (tie) => (a, b) => tie(a, b) || b.score - a.score),
    recommend: pick("recommend", (tie) => (a, b) => tie(a, b) || a.score - b.score),
    updatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=600" } });
}
