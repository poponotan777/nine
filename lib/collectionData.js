// 公開まとめの読み出し(v21)— /c/[slug] のページとOGP画像で共通
import { publicDb, ensureAffiliate } from "./supabaseServer";
import { loadCatalog } from "./catalog";
import { STORE_ORDER } from "./priceView";

export async function loadCollection(slug) {
  const sb = publicDb();
  const { data: col } = await sb.from("collections")
    .select("id, slug, title, subtitle, description, template, author_name, is_public, published_at, updated_at, created_at")
    .eq("slug", String(slug || "").slice(0, 40)).maybeSingle();
  if (!col || !col.is_public) return null;
  const { data: items } = await sb.from("collection_items")
    .select("position, product_key, name, image, headline, comment, prices, snapshot_at")
    .eq("collection_id", col.id).order("position");
  const list = items || [];
  const cat = await loadCatalog(sb, list.map((i) => i.product_key)).catch(() => new Map());
  const enriched = list.map((it) => {
    const e = cat.get(it.product_key);
    const offers = {};
    for (const s of STORE_ORDER) {
      const o = e?.offers?.[s];
      if (o) offers[s] = { ...o, url: ensureAffiliate(s, o.url) };
    }
    return {
      ...it,
      pkey: e?.pkey || it.product_key,
      image: (e?.product?.image && !/media-amazon/.test(e.product.image) ? e.product.image : null) || it.image,
      brand: e?.product?.brand || null,
      tags: e?.product?.tags || [],
      offers,
      snap: it.prices || {},
    };
  });
  return { col, items: enriched };
}
