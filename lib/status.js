// ============================================================
// あなたのステータス(v20)— 端末内(localStorage)だけに保存。サーバーには送らない
//
//  かんたんな記入で、今日の各サイトの還元率(目安)を出す:
//   楽天 :SPU倍率(楽天市場の画面に出る「◯倍」)/楽天カード/会員ランク/買い回り店舗数
//   Yahoo!:ふだんの還元率(%)/PayPayで払う/ヤフショランク
//   Amazon:ふだんの還元率(%)/プライム会員
//  ここで出す数字は「目安」。エントリーや上限・対象外商品は各サイトで確認してもらう。
// ============================================================

import { dailyEvents, upcomingSales } from "./saleCalendar";

const KEY = "oudanStatus";

export const RAKUTEN_RANKS = [
  ["regular", "レギュラー"], ["silver", "シルバー"], ["gold", "ゴールド"], ["platinum", "プラチナ"], ["diamond", "ダイヤモンド"],
];
export const YAHOO_RANKS = [["none", "なし・わからない"], ["silver", "シルバー"], ["gold", "ゴールド"]];

export const DEFAULT_STATUS = {
  set: false,                 // 一度でも保存したか
  applyToPrice: true,         // 今日のセール分を実質価格に含める
  rakuten: { spu: 1, card: false, rank: "regular", shops: 1 },
  yahoo: { base: 1, paypay: false, rank: "none" },
  amazon: { base: 1, prime: false },
};

export function loadStatus() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s) return { ...DEFAULT_STATUS };
    return {
      ...DEFAULT_STATUS, ...s,
      rakuten: { ...DEFAULT_STATUS.rakuten, ...(s.rakuten || {}) },
      yahoo: { ...DEFAULT_STATUS.yahoo, ...(s.yahoo || {}) },
      amazon: { ...DEFAULT_STATUS.amazon, ...(s.amazon || {}) },
    };
  } catch {
    return { ...DEFAULT_STATUS };
  }
}

export function saveStatus(st) {
  const v = { ...st, set: true };
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  return v;
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// 今日の還元率(%)と、その内訳
//   baseRates … 以前からの「ポイント還元率の設定」(ステータス未設定のときの基準)
export function todayRates(status, baseRates = {}, now = new Date(), sheetEvents = []) {
  const st = status || DEFAULT_STATUS;
  const useStatus = !!st.set;
  const daily = dailyEvents(now);
  const live = upcomingSales(now, sheetEvents, 0).filter((e) => e.live);
  const out = {};

  // ---- 楽天 ----
  {
    const lines = [];
    let pct = useStatus ? Math.max(1, num(st.rakuten.spu, 1)) : num(baseRates.rakuten, 1);
    lines.push(useStatus ? `SPU ${pct}倍` : `設定の還元率 ${pct}%`);
    for (const e of daily.filter((x) => x.store === "rakuten")) {
      if (e.key === "rakuten_5_0") {
        if (st.rakuten.card) { pct += 1; lines.push("5と0のつく日 +1倍(エントリー)"); }
        else lines.push("5と0のつく日(楽天カード決済が条件)");
      } else if (e.key === "rakuten_18") {
        const ok = ["gold", "platinum", "diamond"].includes(st.rakuten.rank);
        lines.push(ok ? "ご愛顧感謝デー:ランク特典あり(エントリー)" : "ご愛顧感謝デー(ゴールド以上が対象)");
      } else {
        lines.push(`${e.name}(エントリー)`);
      }
    }
    const big = live.find((e) => e.store === "rakuten" && e.shopBonus);
    if (big) {
      const shops = Math.min(10, Math.max(1, Math.round(num(st.rakuten.shops, 1))));
      if (shops > 1 && useStatus) { pct += shops - 1; lines.push(`${big.name}:${shops}店舗買い回りで +${shops - 1}倍`); }
      else lines.push(`${big.name}開催中:買い回りで最大+9倍`);
    }
    out.rakuten = { pct, lines, events: [...daily.filter((x) => x.store === "rakuten"), ...live.filter((x) => x.store === "rakuten")] };
  }

  // ---- Yahoo! ----
  {
    const lines = [];
    let pct = useStatus ? num(st.yahoo.base, 1) : num(baseRates.yahoo, 1);
    lines.push(`ふだんの還元率 ${pct}%`);
    for (const e of daily.filter((x) => x.store === "yahoo")) {
      if (e.key === "yahoo_5") {
        if (st.yahoo.paypay) { pct += 4; lines.push("5のつく日 +4%(PayPay払い・エントリー)"); }
        else lines.push("5のつく日(PayPay残高・カード払いが条件)");
      } else if (e.key === "yahoo_kansha") {
        lines.push(st.yahoo.rank !== "none" ? "ヤフショ感謝デー:ランク特典あり(エントリー)" : "ヤフショ感謝デー(ランク会員が対象)");
      }
    }
    const big = live.find((e) => e.store === "yahoo");
    if (big) lines.push(`${big.name}開催中:合計金額に応じて+4〜7%(エントリー)`);
    out.yahoo = { pct, lines, events: [...daily.filter((x) => x.store === "yahoo"), ...live.filter((x) => x.store === "yahoo")] };
  }

  // ---- Amazon ----
  {
    const lines = [];
    const pct = useStatus ? num(st.amazon.base, 1) : num(baseRates.amazon, 1);
    lines.push(`ふだんの還元率 ${pct}%`);
    const big = live.find((e) => e.store === "amazon");
    if (big) lines.push(big.primeOnly && !st.amazon.prime ? `${big.name}開催中(プライム会員向け)` : `${big.name}開催中`);
    out.amazon = { pct, lines, events: live.filter((x) => x.store === "amazon") };
  }
  return out;
}

// 実質価格の計算に使う還元率(%)。applyToPrice が OFF ならふだんの値だけ
export function ratesForPrice(status, baseRates = {}, now = new Date(), sheetEvents = []) {
  const t = todayRates(status, baseRates, now, sheetEvents);
  if (!status?.set) return { rakuten: t.rakuten.pct, yahoo: t.yahoo.pct, amazon: t.amazon.pct };
  if (status.applyToPrice === false) {
    return { rakuten: Math.max(1, num(status.rakuten.spu, 1)), yahoo: num(status.yahoo.base, 1), amazon: num(status.amazon.base, 1) };
  }
  return { rakuten: t.rakuten.pct, yahoo: t.yahoo.pct, amazon: t.amazon.pct };
}
