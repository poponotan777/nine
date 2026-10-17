// ============================================================
// 価格の見せ方(v19)— 画面・商品ページ・まとめで共通
//
//   ・3サイト(楽天・Yahoo!・Amazon)を必ず並べる
//   ・各サイトで「90日の中央値より何%安いか」「3か月で何番目に安いか」「今いくらか」
//   ・DBの offers 行(hist = 日ごとの最安値の配列)から計算する
// ============================================================

export const STORE_ORDER = ["rakuten", "yahoo", "amazon"];

export const STORE_META = {
  rakuten: { name: "楽天市場", short: "楽天", color: "#BF0000" },
  yahoo: { name: "Yahoo!ショッピング", short: "Yahoo!", color: "#FF0033" },
  amazon: { name: "Amazon", short: "Amazon", color: "#232F3E" },
};

export const yen = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : "¥" + Math.round(Number(n)).toLocaleString("ja-JP"));

// hist(日ごとの最安値の配列)を [{price, recorded_at, store}] に戻す
export function histRows(offer, store) {
  if (!offer || !Array.isArray(offer.hist) || !offer.hist_start) return [];
  const start = new Date(offer.hist_start + "T00:00:00Z").getTime();
  const out = [];
  offer.hist.forEach((p, i) => {
    if (p == null) return;
    out.push({
      price: Number(p),
      recorded_at: new Date(start + i * 86400000).toISOString().slice(0, 10),
      store: store || offer.store,
    });
  });
  return out;
}

// ある価格が、記録の中でどのくらい安いか
//   days     … 記録がある日数
//   median   … 中央値
//   min      … 最安値
//   rank     … 今の価格は何番目に安いか(1 = 最安)。同じ価格は同じ順位
//   distinct … 出てきた価格の種類
//   diffPct  … 中央値との差(マイナス=安い)
export function statsFor(price, offer) {
  const vals = (offer && Array.isArray(offer.hist) ? offer.hist : []).filter((v) => v != null).map(Number);
  if (!(price > 0) || vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const uniq = [...new Set(sorted)];
  const rank = uniq.filter((v) => v < price).length + 1;
  return {
    days: vals.length,
    median,
    min: sorted[0],
    rank,
    distinct: uniq.length,
    diffPct: median > 0 ? Math.round(((price - median) / median) * 1000) / 10 : 0,
    isLowest: price <= sorted[0],
  };
}

// 統計を短い文にする(画面のバッジ・ツイート共通)
export const MIN_DAYS = 7; // これ未満の記録は「集計中」
export function statsLabel(st) {
  if (!st) return { tone: "none", main: "記録なし", sub: "" };
  if (st.days < MIN_DAYS) return { tone: "none", main: `記録${st.days}日分(集計中)`, sub: "" };
  const rankText = st.isLowest ? "3か月で最安値" : `3か月で${st.rank}番目に安い`;
  const diff = st.diffPct;
  if (diff <= -1) return { tone: "good", main: `中央値より${Math.abs(diff).toFixed(diff > -10 ? 1 : 0)}%安い`, sub: rankText };
  if (diff >= 1) return { tone: "bad", main: `中央値より${diff.toFixed(diff < 10 ? 1 : 0)}%高い`, sub: rankText };
  return { tone: "flat", main: "いつもの価格", sub: rankText };
}

// 実質価格:ユーザーの還元率(%)+その商品のポイント上乗せ(%)
//   楽天の pointRate は「倍」(1倍=1%が通常分)なので、上乗せは pointRate-1
//   Yahoo!・Amazon の point_rate は自動取得で「%」に直して保存している
export function extraPointPct(store, offer) {
  const r = Number(offer?.point_rate) || 0;
  if (!(r > 0)) return 0;
  if (store === "rakuten") return Math.max(0, r - 1);
  return r;
}
export function effectivePrice(store, offer, rates) {
  if (!offer || !(offer.price > 0)) return null;
  const pct = (Number(rates?.[store]) || 0) + extraPointPct(store, offer);
  return Math.round(offer.price * (1 - pct / 100));
}

// 「10/17 17:05」
export function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}

// サイトで探すリンク(その商品がまだ見つかっていないとき)
export function searchUrl(store, q, { amazonTag = "popo-kaiteki-22" } = {}) {
  const k = encodeURIComponent(String(q || "").slice(0, 60));
  if (store === "rakuten") return `https://search.rakuten.co.jp/search/mall/${k}/`;
  if (store === "yahoo") return `https://shopping.yahoo.co.jp/search?p=${k}`;
  return `https://www.amazon.co.jp/s?k=${k}${amazonTag ? `&tag=${amazonTag}` : ""}`;
}

// 商品キー → 商品ページのURL
export const productPath = (pkey) => `/p/${encodeURIComponent(pkey)}`;

// 3サイトのうち、実質価格がいちばん安いサイト
export function bestStore(offersByStore, rates) {
  let best = null;
  for (const s of STORE_ORDER) {
    const o = offersByStore?.[s];
    const e = effectivePrice(s, o, rates);
    if (e != null && (best == null || e < best.eff)) best = { store: s, eff: e, offer: o };
  }
  return best;
}
