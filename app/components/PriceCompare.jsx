"use client";
// ============================================================
// 3サイト価格比較(v19)
//   どこで価格を出すときも、楽天・Yahoo!・Amazon の3行を必ず出す。
//   各行:今の価格/実質価格/90日の中央値との差/3か月で何番目に安いか/セール/購入ボタン
//   見つかっていないサイトは「未取得」として、そのサイトで探すリンクを出す。
// ============================================================

import {
  STORE_ORDER, STORE_META, yen, statsFor, statsLabel, effectivePrice, extraPointPct,
  fmtTime, searchUrl,
} from "../../lib/priceView";

const TONE = {
  good: { color: "#065F46", bg: "#D1FAE5", border: "#10B981" },
  bad: { color: "#92400E", bg: "#FEF3C7", border: "#F59E0B" },
  flat: { color: "#334155", bg: "#F1F5F9", border: "#CBD5E1" },
  none: { color: "#64748B", bg: "#F8FAFC", border: "#E2E8F0" },
};

// offers: 画面の店舗価格の配列(検索・DB由来が混ざってよい)/ dbOffers: {store: DBの行(hist付き)}
export function buildRows({ offers = [], dbOffers = {} }) {
  const rows = {};
  for (const s of STORE_ORDER) {
    const live = offers.filter((o) => o.store === s && o.price > 0).sort((a, b) => a.price - b.price)[0] || null;
    const db = dbOffers?.[s] || null;
    const base = live || (db ? { ...db, store: s, fromDb: true } : null);
    if (!base) { rows[s] = null; continue; }
    rows[s] = {
      ...base,
      point_rate: base.point_rate ?? db?.point_rate ?? null,
      sale_label: base.sale_label ?? db?.sale_label ?? null,
      sale_until: base.sale_until ?? db?.sale_until ?? null,
      updated_at: base.fromDb ? (base.updated_at || db?.updated_at) : null,
      stats: statsFor(base.price, db),
    };
  }
  return rows;
}

export default function PriceCompare({ name, offers, dbOffers, rates, onBuy, compact = false, title = "3サイトの価格比較" }) {
  const rows = buildRows({ offers, dbOffers });
  const effs = STORE_ORDER.map((s) => (rows[s] ? effectivePrice(s, rows[s], rates) : null));
  const bestEff = Math.min(...effs.filter((e) => e != null));
  const order = [...STORE_ORDER].sort((a, b) => {
    const ea = rows[a] ? effectivePrice(a, rows[a], rates) : Infinity;
    const eb = rows[b] ? effectivePrice(b, rows[b], rates) : Infinity;
    return ea - eb;
  });

  return (
    <div>
      {title && <h3 style={{ fontSize: 14, fontWeight: 800, color: "#16324F", margin: "18px 0 10px" }}>{title}</h3>}
      {order.map((s) => {
        const meta = STORE_META[s];
        const o = rows[s];
        if (!o) {
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, padding: compact ? "8px 10px" : "11px 14px", borderRadius: 12, marginBottom: 8, border: "1px dashed #CBD5E1", background: "#FAFAFA" }}>
              <div style={{ width: 64, fontSize: 12.5, fontWeight: 800, color: meta.color }}>{meta.short}</div>
              <div style={{ flex: 1, fontSize: 11.5, color: "#94A3B8" }}>この商品はまだ見つかっていません(次回の自動取得で探します)</div>
              <a href={searchUrl(s, name)} target="_blank" rel="noopener noreferrer sponsored"
                style={{ fontSize: 11.5, fontWeight: 700, color: meta.color, border: `1px solid ${meta.color}`, borderRadius: 8, padding: "7px 10px", textDecoration: "none", whiteSpace: "nowrap" }}>
                {meta.short}で探す
              </a>
            </div>
          );
        }
        const eff = effectivePrice(s, o, rates);
        const isBest = eff === bestEff;
        const lab = statsLabel(o.stats);
        const tone = TONE[lab.tone];
        const extra = extraPointPct(s, o);
        return (
          <div key={s} style={{ padding: compact ? "9px 10px" : "12px 14px", borderRadius: 12, marginBottom: 8, border: isBest ? `1.5px solid ${meta.color}` : "1px solid #E2E8F0", background: isBest ? "#F0FDF6" : "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 64 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: meta.color }}>{meta.short}</div>
                {isBest && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: meta.color, borderRadius: 3, padding: "1px 5px" }}>実質最安</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: compact ? 16 : 19, fontWeight: 800 }}>{yen(o.price)}</span>
                  <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>実質 {yen(eff)}</span>
                  {extra > 0 && <span style={{ fontSize: 10, color: "#B45309", fontWeight: 800 }}>+{Math.round(extra * 10) / 10}%還元</span>}
                </div>
                <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 1 }}>
                  {o.shop ? `${o.shop}` : ""}{o.updated_at ? ` ・ ${fmtTime(o.updated_at)}時点` : " ・ 今の価格"}
                </div>
              </div>
              {o.url ? (
                <a href={o.url} target="_blank" rel="noopener noreferrer sponsored"
                  onClick={() => onBuy?.(s, o)}
                  style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: meta.color, borderRadius: 8, padding: "9px 12px", textDecoration: "none", whiteSpace: "nowrap" }}>
                  {meta.short}で見る
                </a>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 5, padding: "2px 7px" }}>
                {lab.tone === "good" ? "📉 " : lab.tone === "bad" ? "📈 " : ""}{lab.main}
              </span>
              {lab.sub && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: o.stats?.isLowest ? "#065F46" : "#334155", background: o.stats?.isLowest ? "#D1FAE5" : "#F1F5F9", borderRadius: 5, padding: "2px 7px" }}>
                  {o.stats?.isLowest ? "🏆 " : ""}{lab.sub}
                </span>
              )}
              {o.stats && o.stats.days >= 7 && (
                <span style={{ fontSize: 10, color: "#64748B", padding: "2px 2px" }}>
                  中央値 {yen(o.stats.median)} / 最安 {yen(o.stats.min)}(記録{o.stats.days}日)
                </span>
              )}
              {o.sale_label && (
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "#B91C1C", background: "#FEE2E2", borderRadius: 5, padding: "2px 7px" }}>
                  ⚡{o.sale_label}{o.sale_until ? ` 〜${fmtTime(o.sale_until)}` : ""}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <p style={{ fontSize: 10, color: "#94A3B8", margin: "4px 0 0", lineHeight: 1.6 }}>
        【PR】購入リンクはアフィリエイトリンクです。中央値・順位は、オウダンが1日2回記録した各サイトの価格(日ごとの最安)から計算した目安です。
        価格・ポイントは取得時点のもので、変わることがあります。実際の価格は各サイトでご確認ください。
      </p>
    </div>
  );
}

// 検索結果カードなどに出す小さな3サイト表示
export function MiniCompare({ offers, dbOffers, rates }) {
  const rows = buildRows({ offers, dbOffers });
  const effs = STORE_ORDER.map((s) => (rows[s] ? effectivePrice(s, rows[s], rates) : null)).filter((e) => e != null);
  const bestEff = effs.length ? Math.min(...effs) : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginTop: 6 }}>
      {STORE_ORDER.map((s) => {
        const o = rows[s];
        const meta = STORE_META[s];
        const eff = o ? effectivePrice(s, o, rates) : null;
        const best = eff != null && eff === bestEff;
        return (
          <div key={s} style={{ border: best ? `1.5px solid ${meta.color}` : "1px solid #E2E8F0", borderRadius: 7, padding: "3px 5px", background: best ? "#F0FDF6" : "#fff", minWidth: 0 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: meta.color }}>{meta.short}{best ? " 最安" : ""}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: o ? "#16324F" : "#CBD5E1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o ? yen(o.price) : "—"}</div>
          </div>
        );
      })}
    </div>
  );
}
