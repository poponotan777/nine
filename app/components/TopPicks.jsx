"use client";
// トップの「おすすめ・お得・急上昇」(v22)— タップで商品ページ(/p/…)へ
import { useEffect, useState } from "react";
import { productPath, STORE_ORDER, STORE_META, yen, effectivePrice } from "../../lib/priceView";

// カードが細くても切れないよう、3サイトを縦に並べる
function Rows({ offers, rates }) {
  const effs = STORE_ORDER.map((s) => (offers[s] ? effectivePrice(s, offers[s], rates) : null)).filter((v) => v != null);
  const best = effs.length ? Math.min(...effs) : null;
  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
      {STORE_ORDER.map((s) => {
        const o = offers[s];
        const on = o && effectivePrice(s, o, rates) === best;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", fontSize: 11, padding: "1px 5px", borderRadius: 5, background: on ? "#ECFDF5" : "transparent", border: on ? "1px solid #10B981" : "1px solid transparent" }}>
            <span style={{ fontWeight: 800, color: STORE_META[s].color, width: 44 }}>{STORE_META[s].short}</span>
            <span style={{ marginLeft: "auto", fontWeight: 800, color: o ? (on ? "#065F46" : "#16324F") : "#CBD5E1" }}>{o ? yen(o.price) : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

const TABS = [
  ["deal", "📉 お得", "いつも(90日の中央値)より安くなっている商品"],
  ["trend", "🚀 急上昇", "ランキングの順位が急に上がった商品"],
  ["recommend", "🏆 おすすめ", "有名ブランドの人気商品(★4以上)"],
];

export default function TopPicks({ rates }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("deal");
  useEffect(() => {
    fetch("/api/top").then((r) => r.json()).then((d) => {
      setData(d);
      // お得が空なら、中身のあるタブを最初に見せる
      if (!(d.deal || []).length) setTab((d.trend || []).length ? "trend" : "recommend");
    }).catch(() => setData({ deal: [], trend: [], recommend: [] }));
  }, []);
  const list = data?.[tab] || [];
  const desc = TABS.find((t) => t[0] === tab)?.[2];
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, overflowX: "auto" }}>
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ fontSize: 13, fontWeight: 800, borderRadius: 999, padding: "7px 14px", cursor: "pointer", whiteSpace: "nowrap",
              background: tab === k ? "#16324F" : "#fff", color: tab === k ? "#fff" : "#334155", border: `1px solid ${tab === k ? "#16324F" : "#CBD5E1"}` }}>
            {label}{data?.[k]?.length ? `(${data[k].length})` : ""}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 8px" }}>{desc}</p>
      {data === null ? (
        <p style={{ fontSize: 12.5, color: "#64748B" }}>読み込み中…</p>
      ) : list.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#64748B", background: "#fff", border: "1px solid #DDE9E4", borderRadius: 12, padding: 14 }}>
          まだ表示できる商品がありません。毎日の自動取得で価格の記録が貯まると(お得は7日分の記録が必要です)、ここに並びます。
        </p>
      ) : (
        <div className="oud-grid4">
          {list.map((p) => (
            <a key={p.pkey} href={productPath(p.pkey)} style={{ background: "#fff", border: "1px solid #DDE9E4", borderRadius: 14, padding: 10, textDecoration: "none", color: "#16324F", display: "block" }}>
              {p.image ? <img src={p.image} alt="" loading="lazy" style={{ width: "100%", height: 110, objectFit: "contain", borderRadius: 8, background: "#EAF3F0" }} />
                : <div style={{ width: "100%", height: 110, borderRadius: 8, background: "#EAF3F0" }} />}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: tab === "trend" ? "#7C2D12" : "#065F46", background: tab === "trend" ? "#FFEDD5" : "#D1FAE5", borderRadius: 4, padding: "1px 6px" }}>{p.badge}</span>
                {p.sub && <span style={{ fontSize: 10, fontWeight: 700, color: "#334155", background: "#F1F5F9", borderRadius: 4, padding: "1px 6px" }}>{p.sub}</span>}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.35, marginTop: 4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.name}</div>
              <Rows offers={p.offers} rates={rates} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
