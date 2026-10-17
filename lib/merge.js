// ============================================================
// 名寄せ(同一商品のグルーピング)ロジック
// 1. YahooはJANコードを返すので、JANをグループの主キーにする
// 2. 楽天はJANを返さないため、商品名の正規化+トークン一致率で
//    Yahooのグループに合流させる(閾値以下なら独立商品として扱う)
// ============================================================

import { parseQuantity } from "./unitPrice";

// ------------------------------------------------------------
// 容量・種別の互換チェック(誤結合の防止)
// 「500ml×42本」と「500ml×2本」のように容量が桁違いの商品が
// 同じグループに入ると、価格差が異常に見える/最安値が壊れるため、
// 商品名から数量を取り出して一致する場合のみ合流させる。
// ------------------------------------------------------------

// 詰め替え/本体、お試しサイズ、中古などは別商品として扱う
const VARIANT_FLAGS = [
  { key: "refill", re: /詰\s*め?\s*替|つめかえ|レフィル|refill/i },
  { key: "trial", re: /お\s*試し|トライアル|サンプル|試供品|ミニサイズ|携帯用|1回分/ },
  { key: "used", re: /中古|再生品|訳あり|アウトレット|わけあり/ },
];

export function variantCompatible(a, b) {
  for (const f of VARIANT_FLAGS) {
    if (f.re.test(a || "") !== f.re.test(b || "")) return false;
  }
  return true;
}

// 数量が同等か。どちらかが判定不能・単位違いのときは名前類似度の判断に委ねる
export function quantityCompatible(a, b) {
  const qa = parseQuantity(a);
  const qb = parseQuantity(b);
  if (!qa || !qb) return true;
  if (qa.unit !== qb.unit) return true;
  if (!(qa.amount > 0) || !(qb.amount > 0)) return true;
  const ratio = qa.amount / qb.amount;
  return ratio >= 0.9 && ratio <= 1.1; // 1割以内の差なら同容量とみなす
}

// ------------------------------------------------------------
// スペック(規格値)の一致チェック
// モバイルバッテリーの容量(mAh)、ストレージ(GB/TB)、出力(W)、
// 画面サイズ(インチ)などは、商品名が似ていても値が違えば別商品。
// parseQuantityは最初に見つけた1単位しか返さないため、これらは個別に判定する。
// ------------------------------------------------------------
const SPEC_DEFS = [
  // モバイルバッテリー等の容量
  { key: "mah", re: /(\d[\d,]*(?:\.\d+)?)\s*(?:mah|mAh|ｍAh)/gi, scale: 1 },
  // ストレージ(TBはGBに換算して比較)
  { key: "storage", re: /(\d[\d,]*(?:\.\d+)?)\s*(?:tb|ＴＢ|テラバイト)/gi, scale: 1024 },
  { key: "storage", re: /(\d[\d,]*(?:\.\d+)?)\s*(?:gb|ＧＢ|ギガバイト)/gi, scale: 1 },
  // 充電器などの出力
  { key: "watt", re: /(\d[\d,]*(?:\.\d+)?)\s*(?:w|ｗ|ワット)(?![a-z])/gi, scale: 1 },
  // 画面サイズ・寸法
  { key: "inch", re: /(\d[\d,]*(?:\.\d+)?)\s*(?:インチ|型)(?!番)/g, scale: 1 },
];

// 商品名から規格値を取り出す。同じ種類が複数あれば最大値を代表とする
// (例「10000mAh 2台セット」→10000)
function extractSpecs(name) {
  const out = {};
  const s = name || "";
  for (const def of SPEC_DEFS) {
    const re = new RegExp(def.re.source, def.re.flags);
    let m;
    while ((m = re.exec(s)) !== null) {
      const v = parseFloat(String(m[1]).replace(/,/g, "")) * def.scale;
      if (!Number.isFinite(v) || v <= 0) continue;
      out[def.key] = Math.max(out[def.key] || 0, v);
    }
  }
  return out;
}

export function specCompatible(a, b) {
  const sa = extractSpecs(a);
  const sb = extractSpecs(b);
  for (const key of Object.keys(sa)) {
    if (sb[key] == null) continue; // 片方に記載がなければ判定しない
    const ratio = sa[key] / sb[key];
    if (ratio < 0.9 || ratio > 1.1) return false;
  }
  return true;
}

export function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    // 全角英数→半角
    .replace(/[ａ-ｚＡ-Ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // 販促ノイズを除去
    .replace(/【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)/g, " ")
    .replace(/送料無料|ポイント\S*|あす楽|翌日配送|公式|正規品|まとめ買い|お買い得|セール|限定/g, " ")
    .replace(/[^\wぁ-んァ-ヶ一-龠ー0-9a-z]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(name) {
  const n = normalizeName(name);
  const set = new Set();
  // スペース区切りトークン + 2文字グラム(日本語対応)
  for (const t of n.split(" ")) {
    if (t.length >= 2) set.add(t);
  }
  const joined = n.replace(/ /g, "");
  for (let i = 0; i < joined.length - 1; i++) {
    set.add(joined.slice(i, i + 2));
  }
  return set;
}

function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

// 2つの商品名が「同じ商品」と言えるか(v18: 自動取得の他サイト補完で使う)
// 容量・詰め替え・規格値が合っていて、名前の一致度が threshold 以上なら true
export function isSameProduct(a, b, threshold = 0.6) {
  if (!a || !b) return false;
  if (!quantityCompatible(a, b)) return false;
  if (!variantCompatible(a, b)) return false;
  if (!specCompatible(a, b)) return false;
  return similarity(a, b) >= threshold;
}

// 名前の一致度(0〜1)
export function nameSimilarity(a, b) {
  return similarity(a, b);
}

// offers: [{store, name, price, shipping, url, image, rating, reviews, jan}]
// を「商品グループ」の配列にまとめる
export function mergeOffers(allOffers) {
  const groups = [];

  // 1. JANを持つオファー(主にYahoo)でグループの土台を作る
  const byJan = new Map();
  const noJan = [];
  for (const o of allOffers) {
    if (o.jan) {
      if (!byJan.has(o.jan)) byJan.set(o.jan, []);
      byJan.get(o.jan).push(o);
    } else {
      noJan.push(o);
    }
  }
  for (const [jan, offers] of byJan) {
    groups.push({ jan, name: offers[0].name, image: offers[0].image, offers });
  }

  // 2. JANなし(主に楽天)を名前類似度で既存グループへ合流
  const THRESHOLD = 0.55;
  for (const o of noJan) {
    let best = null;
    let bestScore = 0;
    for (const g of groups) {
      // 容量違い(500ml×42本 vs 500ml×2本)や詰め替え/本体の違いは
      // 名前が似ていても別商品なので、合流候補から除外する
      if (!quantityCompatible(o.name, g.name)) continue;
      if (!variantCompatible(o.name, g.name)) continue;
      // mAh/GB/W/インチなどの規格値が違うものは別商品
      if (!specCompatible(o.name, g.name)) continue;
      const s = similarity(o.name, g.name);
      if (s > bestScore) {
        bestScore = s;
        best = g;
      }
    }
    if (best && bestScore >= THRESHOLD) {
      best.offers.push(o);
    } else {
      groups.push({ jan: null, name: o.name, image: o.image, offers: [o] });
    }
  }

  // 3. 各グループを整形:店舗ごとに最安1件へ絞り、代表値を計算
  return groups.map((g) => {
    // 同一グループ内の極端な外れ値を除外する。
    // 同じJANでも出品者が「お試し1包」「付属品のみ」を紐付けている場合があり、
    // これを最安として拾うと価格比較が壊れるため、中央値から大きく外れた
    // 価格(1/4未満 or 4倍超)は候補から落とす。判定には3件以上必要。
    let usable = g.offers;
    if (usable.length >= 3) {
      const sortedP = usable.map((o) => o.price).sort((a, b) => a - b);
      const medP = sortedP[Math.floor(sortedP.length / 2)];
      const kept = usable.filter((o) => o.price >= medP * 0.25 && o.price <= medP * 4);
      if (kept.length > 0) usable = kept;
    }
    const byStore = new Map();
    for (const o of usable) {
      const cur = byStore.get(o.store);
      if (!cur || o.price < cur.price) byStore.set(o.store, o);
    }
    const offers = [...byStore.values()].sort((a, b) => a.price - b.price);
    const best = offers[0];
    const rated = g.offers.filter((o) => o.reviews > 0);
    const reviews = rated.reduce((s, o) => s + o.reviews, 0);
    const rating = rated.length
      ? rated.reduce((s, o) => s + o.rating * o.reviews, 0) / Math.max(reviews, 1)
      : 0;
    // 記録・リスト用キー: JANがあればJAN、無ければモール商品コード
    const best0 = offers[0];
    const key =
      g.jan ||
      (best0.code
        ? (best0.store === "rakuten" ? "r:" : best0.store === "yahoo" ? "y:" : "a:") + best0.code
        : null);
    // 取得順(サーバーの並び)をグループに引き継ぐ: 所属オファーの最小seq
    const seq = Math.min(...g.offers.map((o) => (o.seq != null ? o.seq : Infinity)));
    return {
      jan: g.jan,
      key,
      seq,
      name: g.name,
      image: best.image || g.image,
      offers,
      bestPrice: best.price,
      bestStore: best.store,
      spread: offers.length > 1 ? offers[offers.length - 1].price - best.price : 0,
      rating: Math.round(rating * 10) / 10,
      reviews,
    };
  });
}
