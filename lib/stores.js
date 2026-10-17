import { RAKUTEN_ITEM_SEARCH_URL } from "./rakutenEndpoint";
// ============================================================
// サーバー側API呼び出し
// - Yahoo!: サーバーから呼ぶ(Client IDを秘匿)
// - 楽天: Web型アプリはブラウザから呼ぶ設計のため、
//   検索はブラウザ側(lib/rakutenClient.js)で実行。
//   ここの searchRakutenServer は価格記録cron用の試行実装で、
//   Originヘッダーを付けて呼び、拒否されたら空配列を返す。
// ============================================================

function vcAffiliateUrl(targetUrl) {
  const sid = process.env.VC_SID;
  const pid = process.env.VC_PID;
  if (!sid || !pid) return targetUrl;
  return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${sid}&pid=${pid}&vc_url=${encodeURIComponent(targetUrl)}`;
}

// Yahoo!検索の生結果。ok(成功/失敗)とstatus(HTTPコード)も返すため、
// 呼び出し側で「429などの一時エラー」と「本当に0件」を区別できる。
// 既存のsearchYahoo呼び出しを壊さないよう、searchYahooは下でoffersだけ返す薄いラッパにする。
export async function searchYahooRaw(keyword, hits = 30, janCode = null, start = 1, sort = null, priceFrom = null, priceTo = null) {
  const params = new URLSearchParams({
    appid: process.env.YAHOO_CLIENT_ID,
    results: String(hits),
    start: String(start),
  });
  if (janCode) params.set("jan_code", janCode);
  else params.set("query", keyword);
  // Yahoo!のsort: +price(安い)/-price(高い)/-review_count(レビュー数)/-review_rate(評価)/-sold(売れ筋)
  if (sort) params.set("sort", sort);
  // 価格帯: 安い順のジャンク(無関係な激安小物)をAPI側で除外するために使う
  if (priceFrom) params.set("price_from", String(priceFrom));
  if (priceTo) params.set("price_to", String(priceTo));
  let res;
  try {
    res = await fetch(
      `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?${params}`,
      { next: { revalidate: 300 } }
    );
  } catch (e) {
    // ネットワーク例外も一時エラー扱い(ok:false)
    return { ok: false, status: 0, offers: [] };
  }
  if (!res.ok) {
    console.error("Yahoo API error:", res.status);
    return { ok: false, status: res.status, offers: [] };
  }
  const data = await res.json();
  const offers = (data.hits || []).map((h) => ({
    store: "yahoo",
    name: h.name,
    price: h.price,
    shipping: h.shipping?.code === 1 ? 0 : null,
    url: vcAffiliateUrl(h.url),
    image: h.image?.medium || null,
    rating: h.review?.rate || 0,
    reviews: h.review?.count || 0,
    shop: h.seller?.name,
    jan: h.janCode || null,
    code: h.code || null,
  }));
  return { ok: true, status: 200, offers };
}

export async function searchYahoo(keyword, hits = 30, janCode = null, start = 1, sort = null, priceFrom = null, priceTo = null) {
  const r = await searchYahooRaw(keyword, hits, janCode, start, sort, priceFrom, priceTo);
  return r.offers;
}

// cron用: サーバーから楽天を呼ぶ試行(Web型はOrigin検査があるため
// 失敗する可能性あり。失敗時は空配列=Yahooのみ記録になる)
export async function searchRakutenServer(keyword, hits = 10) {
  const origin = process.env.SITE_ORIGIN || "";
  const params = new URLSearchParams({
    applicationId: (process.env.RAKUTEN_SERVER_APP_ID || process.env.NEXT_PUBLIC_RAKUTEN_APP_ID) || "",
    accessKey: (process.env.RAKUTEN_SERVER_ACCESS_KEY || process.env.NEXT_PUBLIC_RAKUTEN_ACCESS_KEY) || "",
    keyword,
    hits: String(hits),
    format: "json",
    formatVersion: "2",
  });
  try {
    const res = await fetch(
      `${RAKUTEN_ITEM_SEARCH_URL}?${params}`,
      { headers: origin ? { Origin: origin, Referer: origin + "/" } : {} }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.Items || []).map((it) => ({ price: it.itemPrice }));
  } catch {
    return [];
  }
}

// JANコードで各モールの最安値を取る(価格履歴の記録用)
export async function lowestByJan(jan) {
  const [r, y] = await Promise.all([
    searchRakutenServer(jan, 10),
    searchYahoo(null, 10, jan),
  ]);
  const result = [];
  if (r.length) result.push({ store: "rakuten", price: Math.min(...r.map((o) => o.price)) });
  if (y.length) result.push({ store: "yahoo", price: Math.min(...y.map((o) => o.price)) });
  return result;
}
