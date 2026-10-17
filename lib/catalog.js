// ============================================================
// 商品カタログ(v18で作った products / offers)の読み出し
//   画面(ブラウザ)からも、商品ページ(サーバー)からも使う。
//   sb には Supabase のクライアントを渡す(どちらも読み取り専用の公開キーでOK)
// ============================================================

import { STORE_ORDER } from "./priceView";

export const OFFER_COLS =
  "pkey, store, code, url, shop, price, list_price, point_rate, point_until, sale_until, sale_label, review_avg, review_count, rank, rank_genre, trend, updated_at, hist_start, hist, days, median90, min90, rank90, distinct90";
export const PRODUCT_COLS = "pkey, name, brand, genre, image, jan, catch, tags, is_brand, pop, trend, merged_into, last_seen";

const isKey = (k) => typeof k === "string" && k.length >= 3 && k.length <= 140;

// 統合済みのキーを、統合先(正式なキー)に置き換える
export async function resolveKeys(sb, keys) {
  const map = new Map(keys.map((k) => [k, k]));
  let pending = [...new Set(keys.filter(isKey))];
  for (let depth = 0; depth < 3 && pending.length; depth++) {
    const next = [];
    for (let i = 0; i < pending.length; i += 100) {
      const { data } = await sb.from("products").select("pkey, merged_into").in("pkey", pending.slice(i, i + 100)).not("merged_into", "is", null);
      for (const r of data || []) {
        for (const [orig, cur] of map) if (cur === r.pkey) map.set(orig, r.merged_into);
        next.push(r.merged_into);
      }
    }
    pending = [...new Set(next)];
  }
  return map;
}

// キーの一覧 → Map(元のキー → { pkey, product, offers: {rakuten, yahoo, amazon} })
export async function loadCatalog(sb, keys) {
  const out = new Map();
  const clean = [...new Set((keys || []).filter(isKey))].slice(0, 300);
  if (clean.length === 0) return out;
  let resolved;
  try { resolved = await resolveKeys(sb, clean); } catch { resolved = new Map(clean.map((k) => [k, k])); }
  const canon = [...new Set(resolved.values())];
  const products = new Map();
  const offers = new Map();
  for (let i = 0; i < canon.length; i += 100) {
    const part = canon.slice(i, i + 100);
    const [pr, of] = await Promise.all([
      sb.from("products").select(PRODUCT_COLS).in("pkey", part),
      sb.from("offers").select(OFFER_COLS).in("pkey", part),
    ]);
    for (const p of pr.data || []) products.set(p.pkey, p);
    for (const o of of.data || []) {
      if (!offers.has(o.pkey)) offers.set(o.pkey, {});
      offers.get(o.pkey)[o.store] = o;
    }
  }
  for (const [orig, pk] of resolved) {
    if (!products.has(pk) && !offers.has(pk)) continue;
    out.set(orig, { pkey: pk, product: products.get(pk) || null, offers: offers.get(pk) || {} });
  }
  return out;
}

// 1商品(商品ページ用)。統合済みなら redirectTo に統合先を入れて返す
export async function loadProduct(sb, key) {
  if (!isKey(key)) return null;
  const { data: p } = await sb.from("products").select(PRODUCT_COLS).eq("pkey", key).maybeSingle();
  if (!p) return null;
  if (p.merged_into) {
    const m = await resolveKeys(sb, [key]);
    return { redirectTo: m.get(key) };
  }
  const { data: of } = await sb.from("offers").select(OFFER_COLS).eq("pkey", key);
  const offers = {};
  for (const o of of || []) offers[o.store] = o;
  return { product: p, offers };
}

// 同じジャンルの人気商品(商品ページの下に出す)
export async function loadRelated(sb, product, n = 8) {
  if (!product?.genre) return [];
  const { data } = await sb.from("products").select("pkey, name, image, pop")
    .eq("genre", product.genre).is("merged_into", null).not("pop", "is", null).neq("pkey", product.pkey)
    .order("pop", { ascending: true }).limit(n);
  return data || [];
}

// DBの価格行 → 画面の「店舗の価格」(検索結果と同じ形)
export function offerFromDb(store, o, product) {
  return {
    store,
    name: product?.name || "",
    price: o.price,
    shipping: null,
    url: o.url,
    image: product?.image || null,
    rating: o.review_avg || 0,
    reviews: o.review_count || 0,
    shop: o.shop,
    jan: product?.jan || null,
    code: o.code,
    fromDb: true,
    updated_at: o.updated_at,
    point_rate: o.point_rate,
    sale_label: o.sale_label,
    sale_until: o.sale_until,
  };
}

// 検索結果の商品に、DBにある他サイトの価格を足す(3サイト比較を埋める)
export function augmentProduct(p, entry) {
  if (!entry) return p;
  const have = new Set(p.offers.map((o) => o.store));
  const add = [];
  for (const s of STORE_ORDER) {
    if (!have.has(s) && entry.offers[s]) add.push(offerFromDb(s, entry.offers[s], entry.product || p));
  }
  const offers = [...p.offers, ...add].sort((a, b) => a.price - b.price);
  return {
    ...p,
    key: p.key || entry.pkey,
    pkey: entry.pkey,
    db: entry,
    offers,
    bestPrice: offers[0]?.price ?? p.bestPrice,
    bestStore: offers[0]?.store ?? p.bestStore,
  };
}
