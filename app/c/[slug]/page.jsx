// ============================================================
// 商品まとめ(公開ページ)v21 /c/{slug}
//   テンプレート:ranking(TOP N)/ lineup(横並びN選)/ compare(比較リスト)
//   価格は「今の3サイト価格」を必ず並べ、作成時の価格も小さく添える
//   リンクはすべて運営のアフィリエイトID
// ============================================================

import { notFound } from "next/navigation";
import { COLLECTIONS_ON } from "../../../lib/featureFlags";
import { loadCollection } from "../../../lib/collectionData";
import { STORE_ORDER, STORE_META, yen, fmtTime, productPath, statsFor, statsLabel } from "../../../lib/priceView";
import { PAIN_BY_KEY } from "../../../lib/pains";
import { SITE } from "../../../lib/supabaseServer";

export const revalidate = 600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

const KICKER = { ranking: (n) => `TOP${n}`, lineup: (n) => `${n}選`, compare: () => "比較" };

export async function generateMetadata({ params }) {
  if (!COLLECTIONS_ON) return { title: "準備中 | オウダン" };
  const { slug } = await params;
  const d = await loadCollection(slug).catch(() => null);
  if (!d) return { title: "見つかりません | オウダン" };
  const n = d.items.length;
  const title = `${d.col.title}【${KICKER[d.col.template]?.(n) || ""}】| オウダン`;
  const description = d.col.subtitle || d.col.description || `楽天・Yahoo!・Amazonの価格を比べた商品まとめ(${n}商品)`;
  return {
    title,
    description,
    alternates: { canonical: `/c/${d.col.slug}` },
    openGraph: { title: d.col.title, description, url: `${SITE}/c/${d.col.slug}`, siteName: "オウダン", type: "article" },
    twitter: { card: "summary_large_image", title: d.col.title, description },
  };
}

function cheapest(offers) {
  let b = null;
  for (const s of STORE_ORDER) if (offers[s] && (!b || offers[s].price < offers[b].price)) b = s;
  return b;
}

function PriceTable({ it }) {
  const best = cheapest(it.offers);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
      {STORE_ORDER.map((s) => {
        const o = it.offers[s];
        const meta = STORE_META[s];
        const on = s === best;
        const snap = it.snap?.[s];
        const lab = o ? statsLabel(statsFor(o.price, o)) : null;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: on ? `1.5px solid ${meta.color}` : "1px solid #E2E8F0", background: on ? "#F0FDF6" : "#fff" }}>
            <div style={{ width: 58, fontSize: 12, fontWeight: 800, color: meta.color }}>
              {meta.short}
              {on && <div style={{ fontSize: 9.5, color: "#fff", background: meta.color, borderRadius: 3, padding: "0 4px", display: "inline-block" }}>最安</div>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: o ? "#16324F" : "#CBD5E1" }}>{o ? yen(o.price) : "未取得"}</div>
              <div style={{ fontSize: 10, color: "#64748B" }}>
                {snap != null && o && snap !== o.price ? `作成時 ${yen(snap)} ・ ` : ""}
                {o?.updated_at ? `${fmtTime(o.updated_at)}時点` : ""}
                {lab && lab.tone === "good" ? ` ・ ${lab.main}` : ""}
              </div>
            </div>
            {o?.url ? (
              <a href={o.url} target="_blank" rel="noopener noreferrer sponsored" style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: meta.color, borderRadius: 8, padding: "8px 10px", textDecoration: "none", whiteSpace: "nowrap" }}>
                {meta.short}で見る
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ItemCard({ it, i, template }) {
  const medal = ["#E3A008", "#9CA3AF", "#B7791F"];
  const tags = (it.tags || []).map((t) => PAIN_BY_KEY[t]).filter(Boolean).slice(0, 2);
  return (
    <article style={{ background: "#fff", border: "1px solid #DDE9E4", borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          {template === "ranking" ? (
            <div style={{ minWidth: 52, textAlign: "center", fontSize: 16, fontWeight: 900, color: "#fff", background: medal[i] || "#16324F", borderRadius: 999, padding: "3px 10px" }}>{i + 1}位</div>
          ) : (
            <div style={{ minWidth: 30, textAlign: "center", fontSize: 14, fontWeight: 900, color: "#fff", background: "#16324F", borderRadius: 999, padding: "2px 8px" }}>{i + 1}</div>
          )}
          {it.image ? <img src={it.image} alt="" style={{ width: 110, height: 110, objectFit: "contain", borderRadius: 12, background: "#F3F6F4" }} /> : <div style={{ width: 110, height: 110, borderRadius: 12, background: "#F3F6F4" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {it.brand && <div style={{ fontSize: 11, fontWeight: 800, color: "#64748B" }}>{it.brand}</div>}
          <h2 style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.45, margin: "2px 0 0" }}>
            <a href={productPath(it.pkey)} style={{ color: "#16324F", textDecoration: "none" }}>{it.name}</a>
          </h2>
          {it.headline && <div style={{ fontSize: 13, fontWeight: 800, color: "#B45309", marginTop: 6 }}>{it.headline}</div>}
          {tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {tags.map((t) => <span key={t.key} style={{ fontSize: 10.5, fontWeight: 700, color: "#065F46", background: "#ECFDF5", borderRadius: 999, padding: "2px 8px" }}>✅ {t.label}</span>)}
            </div>
          )}
        </div>
      </div>
      {it.comment && <p style={{ fontSize: 13, color: "#334155", lineHeight: 1.75, margin: "12px 0 0", whiteSpace: "pre-wrap" }}>{it.comment}</p>}
      <PriceTable it={it} />
      <a href={productPath(it.pkey)} style={{ display: "inline-block", marginTop: 8, fontSize: 11.5, fontWeight: 700, color: "#2563EB", textDecoration: "none" }}>この商品の価格の動き(中央値・3か月で何番目)を見る →</a>
    </article>
  );
}

function CompareTable({ items }) {
  return (
    <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #DDE9E4", borderRadius: 14, marginBottom: 16 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "#F3F6F4" }}>
            <th style={{ textAlign: "left", padding: "10px 12px" }}>商品</th>
            {STORE_ORDER.map((s) => <th key={s} style={{ textAlign: "right", padding: "10px 12px", color: STORE_META[s].color, whiteSpace: "nowrap" }}>{STORE_META[s].short}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const best = cheapest(it.offers);
            return (
              <tr key={i} style={{ borderTop: "1px solid #E2E8F0" }}>
                <td style={{ padding: "10px 12px" }}>
                  <a href={productPath(it.pkey)} style={{ color: "#16324F", fontWeight: 700, textDecoration: "none" }}>{it.name.slice(0, 40)}</a>
                </td>
                {STORE_ORDER.map((s) => {
                  const o = it.offers[s];
                  return (
                    <td key={s} style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {o ? (
                        <a href={o.url} target="_blank" rel="noopener noreferrer sponsored" style={{ fontWeight: 800, color: s === best ? "#059669" : "#16324F", background: s === best ? "#ECFDF5" : "transparent", borderRadius: 6, padding: "2px 6px", textDecoration: "none" }}>
                          {yen(o.price)}{s === best ? " 最安" : ""}
                        </a>
                      ) : <span style={{ color: "#CBD5E1" }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function CollectionPage({ params }) {
  if (!COLLECTIONS_ON) {
    return <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>この機能は準備中です。</div>;
  }
  const { slug } = await params;
  const d = await loadCollection(slug).catch(() => null);
  if (!d) notFound();
  const { col, items } = d;
  const tpl = col.template || "ranking";
  const n = items.length;
  const shareText = encodeURIComponent(`${col.title}\n${SITE}/c/${col.slug}\n#PR`);

  return (
    <div style={{ minHeight: "100vh", background: "#F0F6F4", fontFamily: "'Hiragino Sans','Noto Sans JP',-apple-system,sans-serif", color: "#16324F" }}>
      <header style={{ background: "#16324F", padding: "12px 16px" }}>
        <div className="oud-wrap" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/" style={{ color: "#fff", fontWeight: 800, fontSize: 17, textDecoration: "none" }}>オウダン</a>
          <a href="/c" style={{ color: "#CBD5E1", fontSize: 12, textDecoration: "none" }}>まとめ一覧</a>
        </div>
      </header>
      <main className="oud-wrap" style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#E3A008", display: "inline-block", borderRadius: 6, padding: "2px 10px" }}>{KICKER[tpl]?.(n)}</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.4, margin: "8px 0 4px" }}>{col.title}</h1>
        {col.subtitle && <p style={{ fontSize: 13.5, color: "#334155", margin: "0 0 6px", lineHeight: 1.6 }}>{col.subtitle}</p>}
        <div style={{ fontSize: 11, color: "#64748B" }}>
          作成:{col.author_name || "オウダン編集部"} ・ {fmtTime(col.updated_at || col.created_at).split(" ")[0]}更新 ・ 【PR】
        </div>
        {col.description && <p style={{ fontSize: 13.5, color: "#334155", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: "14px 0" }}>{col.description}</p>}

        {tpl === "compare" && <CompareTable items={items} />}

        <div style={{ marginTop: 14 }} className={tpl === "lineup" ? "oud-grid" : undefined}>
          {items.map((it, i) => <ItemCard key={i} it={it} i={i} template={tpl} />)}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <a href={`https://x.com/intent/post?text=${shareText}`} target="_blank" rel="noopener noreferrer" style={{ background: "#000", color: "#fff", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 800, textDecoration: "none" }}>Xでシェア</a>
          <a href="/" style={{ background: "#fff", color: "#16324F", border: "1.5px solid #16324F", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 800, textDecoration: "none" }}>オウダンで他の商品を比べる</a>
        </div>

        <p style={{ fontSize: 10.5, color: "#94A3B8", lineHeight: 1.7, marginTop: 18 }}>
          【PR】このページの購入リンクはアフィリエイトリンクです(楽天アフィリエイト・バリューコマース・Amazonアソシエイト)。
          Amazonのアソシエイトとして、オウダンは適格販売により収入を得ています。
          価格は各時点のもので変わることがあります。購入前に各サイトでご確認ください。
        </p>
      </main>
    </div>
  );
}
