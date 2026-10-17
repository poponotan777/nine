"use client";
import { RAKUTEN_ITEM_SEARCH_URL } from "./rakutenEndpoint";
// ============================================================
// 楽天API(Webアプリケーション型)をブラウザから直接呼び出す
// Web型はブラウザの発信元(Origin)で認証するため、
// キーはNEXT_PUBLIC_として公開される設計(楽天の想定通り)
// ============================================================

export async function searchRakutenClient(keyword, hits = 30, page = 1, sort = null, minPrice = null, maxPrice = null) {
  const params = new URLSearchParams({
    applicationId: process.env.NEXT_PUBLIC_RAKUTEN_APP_ID,
    accessKey: process.env.NEXT_PUBLIC_RAKUTEN_ACCESS_KEY,
    affiliateId: process.env.NEXT_PUBLIC_RAKUTEN_AFFILIATE_ID || "",
    keyword,
    hits: String(hits),
    page: String(page),
    sort: sort || "standard",
    formatVersion: "2",
    format: "json",
  });
  // 価格帯: 安い順のジャンク除外・高い順の誤登録除外をAPI側で行う
  if (minPrice) params.set("minPrice", String(minPrice));
  if (maxPrice) params.set("maxPrice", String(maxPrice));
  try {
    const res = await fetch(
      `${RAKUTEN_ITEM_SEARCH_URL}?${params}`
    );
    if (!res.ok) {
      console.error("Rakuten API error:", res.status);
      return [];
    }
    const data = await res.json();
    return (data.Items || []).map((it) => ({
      store: "rakuten",
      name: it.itemName,
      price: it.itemPrice,
      shipping: it.postageFlag === 0 ? 0 : null,
      url: it.affiliateUrl || it.itemUrl,
      image:
        (typeof it.mediumImageUrls?.[0] === "string"
          ? it.mediumImageUrls[0]
          : it.mediumImageUrls?.[0]?.imageUrl
        )?.replace("?_ex=128x128", "?_ex=300x300") || null,
      rating: it.reviewAverage || 0,
      reviews: it.reviewCount || 0,
      shop: it.shopName,
      jan: null,
      code: it.itemCode || null,
    }));
  } catch (e) {
    console.error("Rakuten fetch failed:", e);
    return [];
  }
}
