"use client";
// 商品ページの中身(v19)。還元率(端末内の設定)で実質価格を出すためブラウザ側で描画する
import { useEffect, useState } from "react";
import PriceCompare from "../../components/PriceCompare";
import { PAIN_BY_KEY } from "../../../lib/pains";
import { STORE_ORDER, STORE_META, statsFor, statsLabel, yen, effectivePrice, productPath } from "../../../lib/priceView";
import { loadStatus, ratesForPrice } from "../../../lib/status";

const DEFAULT_RATES = { rakuten: 1, yahoo: 1, amazon: 1 };
function loadRates() {
  try {
    const s = localStorage.getItem("pointRates");
    return s ? { ...DEFAULT_RATES, ...JSON.parse(s) } : DEFAULT_RATES;
  } catch {
    return DEFAULT_RATES;
  }
}

export default function ProductView({ product, offers, related }) {
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  // 端末に保存した還元率+「あなたのステータス」(今日のセール分を含む)で実質価格を出す
  useEffect(() => { setRates(ratesForPrice(loadStatus(), loadRates(), new Date(), [])); }, []);

  // 閲覧履歴(端末内)にも残す。トップの「最近見た商品」に出る
  useEffect(() => {
    try {
      const cheapest = STORE_ORDER.map((s) => offers[s]).filter(Boolean).sort((a, b) => a.price - b.price)[0];
      const vh = JSON.parse(localStorage.getItem("viewHistory") || "[]");
      const entry = { key: product.pkey, name: product.name, image: product.image, price: cheapest?.price ?? null, store: cheapest?.store, at: Date.now() };
      localStorage.setItem("viewHistory", JSON.stringify([entry, ...vh.filter((x) => x.key !== product.pkey)].slice(0, 30)));
    } catch {}
  }, [product, offers]);

  let best = null;
  for (const s of STORE_ORDER) {
    const e = effectivePrice(s, offers[s], rates);
    if (e != null && (!best || e < best.eff)) best = { s, eff: e, o: offers[s] };
  }
  const bestLab = best ? statsLabel(statsFor(best.o.price, best.o)) : null;
  const tags = (product.tags || []).map((t) => PAIN_BY_KEY[t]).filter(Boolean);

  const share = async () => {
    const url = window.location.origin + productPath(product.pkey);
    const lines = [
      `【${product.name.slice(0, 40)}】`,
      STORE_ORDER.map((s) => `${STORE_META[s].short} ${offers[s] ? yen(offers[s].price) : "—"}`).join(" / "),
      best && bestLab && bestLab.tone !== "none" ? `📊 ${STORE_META[best.s].short}が${bestLab.main}・${bestLab.sub}` : "",
      url,
      "#オウダン #PR",
    ].filter(Boolean);
    const text = lines.join("\n");
    try {
      if (navigator.share) await navigator.share({ title: product.name, text });
      else { await navigator.clipboard.writeText(text); setMsg("共有用のテキストをコピーしました"); setTimeout(() => setMsg(""), 3000); }
    } catch {}
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F0F6F4", fontFamily: "'Hiragino Sans','Noto Sans JP',-apple-system,sans-serif", color: "#16324F" }}>
      <header style={{ background: "#16324F", padding: "12px 16px" }}>
        <div className="oud-wrap" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/" style={{ color: "#fff", fontWeight: 800, fontSize: 17, textDecoration: "none", whiteSpace: "nowrap" }}>オウダン</a>
          <form action="/" method="get" style={{ flex: 1, display: "flex", gap: 6 }} className="oud-search">
            <input name="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="商品名で探す"
              style={{ flex: 1, minWidth: 0, border: "none", borderRadius: 8, padding: "9px 12px", fontSize: 16, outline: "none" }} />
            <button type="submit" style={{ background: "#10B981", color: "#fff", border: "none", borderRadius: 8, padding: "0 14px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>検索</button>
          </form>
        </div>
      </header>

      <main className="oud-wrap" style={{ padding: "14px 16px 40px" }}>
        <div style={{ background: "#fff", border: "1px solid #DDE9E4", borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", gap: 14 }}>
            {product.image && (
              <img src={product.image} alt="" style={{ width: 120, height: 120, objectFit: "contain", borderRadius: 12, background: "#EAF3F0", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {product.brand && <div style={{ fontSize: 11, fontWeight: 800, color: "#64748B" }}>{product.brand}</div>}
              <h1 style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.45, margin: "2px 0 0" }}>{product.name}</h1>
              {product.genre && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>{product.genre}</div>}
              {product.jan && <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 2 }}>JAN: {product.jan}</div>}
            </div>
          </div>

          {best && (
            <div style={{ marginTop: 14, background: "#ECFDF5", border: "1.5px solid #10B981", borderRadius: 12, padding: "11px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#065F46" }}>いちばん安いのは <span style={{ color: STORE_META[best.s].color }}>{STORE_META[best.s].short}</span></div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#065F46", marginTop: 2 }}>
                {yen(best.o.price)} <span style={{ fontSize: 12, fontWeight: 700 }}>実質 {yen(best.eff)}</span>
              </div>
              {bestLab && bestLab.tone !== "none" && (
                <div style={{ fontSize: 11.5, color: "#065F46", fontWeight: 700, marginTop: 2 }}>📊 {bestLab.main}・{bestLab.sub}</div>
              )}
            </div>
          )}

          <PriceCompare name={product.name} offers={[]} dbOffers={offers} rates={rates} />

          {product.catch && (
            <p style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.7, margin: "14px 0 0" }}>{product.catch}</p>
          )}

          {tags.length > 0 && (
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px 14px", marginTop: 14 }}>
              <h2 style={{ fontSize: 13, fontWeight: 800, color: "#16324F", margin: "0 0 6px" }}>こんな悩みに</h2>
              {tags.map((t) => (
                <div key={t.key} style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.75 }}>
                  ✅ <b>{t.pain}</b> → {t.benefit}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={share} style={{ border: "1px solid #CBD5E1", background: "#fff", borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              📣 この比較を共有する
            </button>
            <a href={`/?q=${encodeURIComponent(product.name.slice(0, 30))}`} style={{ fontSize: 12, color: "#2563EB", fontWeight: 700, textDecoration: "none" }}>
              似た商品をオウダンで探す →
            </a>
            {msg && <span style={{ fontSize: 11.5, color: "#059669", fontWeight: 700 }}>{msg}</span>}
          </div>
          <p style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 10, lineHeight: 1.6 }}>
            実質価格は、端末に保存した還元率・ステータス(トップ → マイページ)と今日のセールで計算した目安です。未設定なら各サイト1%です。
          </p>
        </div>

        {related && related.length > 0 && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 10px" }}>{product.genre}の人気商品</h2>
            <div className="oud-grid4">
              {related.map((r) => (
                <a key={r.pkey} href={productPath(r.pkey)} style={{ background: "#fff", border: "1px solid #DDE9E4", borderRadius: 12, padding: 10, textDecoration: "none", color: "#16324F" }}>
                  {r.image ? <img src={r.image} alt="" style={{ width: "100%", height: 100, objectFit: "contain", background: "#EAF3F0", borderRadius: 8 }} /> : null}
                  <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.35, marginTop: 6, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.name}</div>
                </a>
              ))}
            </div>
          </section>
        )}

        <footer style={{ marginTop: 28, paddingTop: 14, borderTop: "1px solid #DDE9E4", textAlign: "center" }}>
          <a href="/privacy" style={{ fontSize: 11.5, color: "#64748B", textDecoration: "none" }}>プライバシーポリシー</a>
          <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 6, lineHeight: 1.6 }}>
            【PR】本サイトは楽天アフィリエイト・バリューコマース・Amazonアソシエイトを利用しています。
            Amazonのアソシエイトとして、オウダンは適格販売により収入を得ています。
          </div>
        </footer>
      </main>
    </div>
  );
}
