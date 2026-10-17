// ============================================================
// 商品ページ(v19) /p/{商品キー}
//   ・商品ごとに自分のURLを持つ → Google検索・Xのリンクカード・共有の入口になる
//   ・DB(自動取得の結果)だけで表示する。見られるたびに外部APIは呼ばない
//   ・1時間ごとに作り直す(それまでは同じページをそのまま返す)
// ============================================================

import { notFound, permanentRedirect } from "next/navigation";
import { publicDb, SITE, ensureAffiliate } from "../../../lib/supabaseServer";
import { loadProduct, loadRelated } from "../../../lib/catalog";
import { STORE_ORDER, STORE_META, statsFor, statsLabel, yen, fmtTime, productPath } from "../../../lib/priceView";
import ProductView from "./ProductView";

export const revalidate = 3600;
// 事前には作らず、最初に見られたときに作って1時間キャッシュする(ISR)
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

function decodeKey(raw) {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

async function getData(rawKey) {
  const key = decodeKey(String(rawKey || ""));
  const sb = publicDb();
  const data = await loadProduct(sb, key).catch(() => null);
  if (!data) return null;
  if (data.redirectTo) return { redirectTo: data.redirectTo };
  for (const s of STORE_ORDER) {
    if (data.offers[s]) data.offers[s] = { ...data.offers[s], url: ensureAffiliate(s, data.offers[s].url) };
  }
  return { ...data, key };
}

function priceSummary(offers) {
  const parts = [];
  let newest = null;
  for (const s of STORE_ORDER) {
    const o = offers[s];
    parts.push(`${STORE_META[s].short} ${o ? yen(o.price) : "—"}`);
    if (o?.updated_at && (!newest || o.updated_at > newest)) newest = o.updated_at;
  }
  return { text: parts.join(" / "), at: newest };
}

export async function generateMetadata({ params }) {
  const { key } = await params;
  const d = await getData(key);
  if (!d || d.redirectTo) return { title: "商品が見つかりません | オウダン" };
  const p = d.product;
  const sum = priceSummary(d.offers);
  const cheapest = STORE_ORDER.map((s) => d.offers[s] && { s, o: d.offers[s] }).filter(Boolean).sort((a, b) => a.o.price - b.o.price)[0];
  const lab = cheapest ? statsLabel(statsFor(cheapest.o.price, cheapest.o)) : null;
  const title = `${p.name.slice(0, 48)}の最安値|楽天・Yahoo!・Amazon比較`;
  const description = `${sum.text}${sum.at ? `(${fmtTime(sum.at)}時点)` : ""}。${cheapest ? `いちばん安いのは${STORE_META[cheapest.s].short}。` : ""}${lab && lab.tone !== "none" ? `${lab.main}・${lab.sub}。` : ""}ポイント込みの実質価格で3サイトを比較。`;
  return {
    title,
    description,
    alternates: { canonical: productPath(p.pkey) },
    openGraph: { title, description, url: SITE + productPath(p.pkey), siteName: "オウダン", type: "website" },
    // 画像は同じフォルダの opengraph-image.jsx(3サイト価格の画像)が自動で使われる
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ProductPage({ params }) {
  const { key } = await params;
  const d = await getData(key);
  if (!d) notFound();
  if (d.redirectTo) permanentRedirect(productPath(d.redirectTo));
  const related = await loadRelated(publicDb(), d.product, 8).catch(() => []);

  // 検索エンジン向けの商品情報(構造化データ)
  const prices = STORE_ORDER.map((s) => d.offers[s]?.price).filter((v) => v > 0);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: d.product.name,
    ...(d.product.image && !/media-amazon/.test(d.product.image) ? { image: [d.product.image] } : {}),
    ...(d.product.brand ? { brand: { "@type": "Brand", name: d.product.brand } } : {}),
    ...(d.product.jan && d.product.jan.length === 13 ? { gtin13: d.product.jan } : {}),
    ...(prices.length
      ? { offers: { "@type": "AggregateOffer", priceCurrency: "JPY", lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: prices.length } }
      : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <ProductView product={d.product} offers={d.offers} related={related} />
    </>
  );
}
